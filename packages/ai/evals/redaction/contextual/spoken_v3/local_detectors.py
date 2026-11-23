"""Load and run the pinned local detectors shared by redaction and its evaluator."""

from hashlib import file_digest

from candidate import Hit


MODEL_FILES = {
    "gliner_config.json": "c10803bade021f40072b194bc78bc2edd2bf3e60637a6f34cc9b00705bf3c168",
    "model_quint8.onnx": "891589426ee96f2748b16439f44fad8c3f97e198e002a6637e58dee989500216",
    "special_tokens_map.json": "ea97ecdbcc73713039d8d64dbb05e3689495c96657fbd9a18f5bed381be81049",
    "tokenizer.json": "84b3a9b18f04a0ccd03b72d9f871b7e0bec40fd7021ef50bc30a7c3693c11205",
    "tokenizer_config.json": "3398f6d1ad4b4c4f9874d390d060a75c58cad5e5ce9b22841b3e40643b4ada27",
}


def _verify_model(directory):
    if {item.name for item in directory.iterdir()} != MODEL_FILES.keys():
        raise ValueError("Expected exactly the pinned contextual model files")
    for name, expected in MODEL_FILES.items():
        with (directory / name).open("rb") as artifact:
            if file_digest(artifact, "sha256").hexdigest() != expected:
                raise ValueError(f"Contextual model asset differs from its pin: {name}")


def _require_full_model_input(model, text, labels):
    processor = model.data_processor
    words = [token for token, _, _ in processor.words_splitter(text)]
    if not words or len(words) > model.config.max_len:
        raise ValueError("Context recognizer cannot process the full input")
    prompted, prompt_lengths = processor.prepare_inputs([words], labels)
    tokenizer = processor.transformer_tokenizer
    encoded = tokenizer(prompted, is_split_into_words=True, truncation=False)
    max_tokens = min(tokenizer.model_max_length, model.config.encoder_config.max_position_embeddings)
    source_words = {index for index in encoded.word_ids(0) if index is not None and index >= prompt_lengths[0]}
    expected_words = set(range(prompt_lengths[0], prompt_lengths[0] + len(words)))
    if len(encoded.input_ids[0]) > max_tokens or source_words != expected_words:
        raise ValueError("Context recognizer cannot process the full input")


class LocalDetectors:
    def __init__(self, directory):
        _verify_model(directory)

        from benchmark import THRESHOLD, add_contact_patterns, candidate_analyzer
        from gliner import GLiNER
        from onnxruntime import SessionOptions

        self._analyzer_threshold = THRESHOLD
        self._analyzer = candidate_analyzer()
        add_contact_patterns(self._analyzer)
        options = SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self._model = GLiNER.from_pretrained(
            directory, local_files_only=True, map_location="cpu", runtime="onnxruntime",
            runtime_model_file="model_quint8.onnx", runtime_options={"session_options": options},
        )

    def deterministic(self, text):
        for hit in self._analyzer.analyze(
            text=text, language="en", score_threshold=self._analyzer_threshold,
            entities=["PHONE_NUMBER", "EMAIL_ADDRESS", "ORGANIZATION"],
        ):
            if not 0 <= hit.start < hit.end <= len(text):
                raise ValueError("Deterministic recognizer returned an invalid source span")
            yield Hit(hit.entity_type, hit.start, hit.end)

    def contextual(self, text, labels):
        _require_full_model_input(self._model, text, labels)
        for hit in self._model.predict_entities(text, labels, threshold=0.5):
            start, end = hit["start"], hit["end"]
            if not 0 <= start < end <= len(text) or text[start:end] != hit["text"]:
                raise ValueError("Context recognizer returned an invalid source span")
            yield Hit(hit["label"], start, end)
