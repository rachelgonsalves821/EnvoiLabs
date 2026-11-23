"""Try learned casing and punctuation on an offset-preserving model input."""

from hashlib import file_digest
import json
import re

from redaction_input import RedactionInputTooLong
from speech_context import Restored


MODEL_REVISION = "a527b62e5a3e16de7e316f03234c99422b1c8814"
MODEL_FILES = {
    "config.json": "968fa6c797aa9048264d6be3765d462efa27639df5d6a580aef3e8bb187d60dc",
    "tokenizer.json": "f34b44a6dc8a0eef651bfa10e8325057530152606a69d9c3b6ae02efb1558f0a",
    "model_quantized.onnx": "a732af171c17413f709d2a37550353cb92d0f07412fc5b7ed0cf7e34efa1ec57",
}
_WORD = re.compile(r"\S+")


def _apply_case(value, mode):
    if mode == "UPPER":
        transformed = value.upper()
    elif mode == "Cap":
        transformed = value[0].upper() + value[1:]
    else:
        transformed = value
    return transformed if len(transformed) == len(value) else value


def restore_word_marks(text, labels):
    result, offsets, previous = [], [], 0
    for word in _WORD.finditer(text):
        start, end = word.span()
        mark, mode = labels.get(end, "0|lower").split("|")
        result.append(text[previous:start])
        offsets.extend(range(previous, start))
        result.append(_apply_case(word.group(), mode))
        offsets.extend(range(start, end))
        if mark != "0":
            mark = " -" if mark == "-" else mark
            result.append(mark)
            offsets.extend([None] * len(mark))
        previous = end
    result.append(text[previous:])
    offsets.extend(range(previous, len(text)))
    return Restored("".join(result), tuple(offsets))


class LocalCasingModel:
    def __init__(self, directory):
        from onnxruntime import InferenceSession, SessionOptions
        from tokenizers import Tokenizer

        for name, expected in MODEL_FILES.items():
            with (directory / name).open("rb") as artifact:
                if file_digest(artifact, "sha256").hexdigest() != expected:
                    raise ValueError(f"Casing asset differs from the pinned model: {name}")
        self._tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self._tokenizer.no_truncation()
        self._labels = json.loads((directory / "config.json").read_text(encoding="utf-8"))["id2label"]
        options = SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        self._session = InferenceSession(
            str(directory / "model_quantized.onnx"), sess_options=options, providers=["CPUExecutionProvider"],
        )
        self._inputs = {value.name for value in self._session.get_inputs()}

    def restore(self, text):
        import numpy as np

        if text != text.lower():
            raise ValueError("The casing evaluation expects lowercase recognized speech")
        encoded = self._tokenizer.encode(text)
        if len(encoded.ids) > 512:
            raise RedactionInputTooLong("Casing input exceeds the model limit")
        if not encoded.ids or not any(encoded.special_tokens_mask):
            raise ValueError("Unexpected casing input shape")
        arrays = {
            "input_ids": encoded.ids, "attention_mask": encoded.attention_mask, "token_type_ids": encoded.type_ids,
        }
        tensors = {name: np.asarray([arrays[name]], dtype=np.int64) for name in self._inputs}
        logits = self._session.run(None, tensors)[0]
        labels = {
            end: self._labels[str(int(label))]
            for (start, end), label in zip(encoded.offsets, logits[0].argmax(-1), strict=True) if end > start
        }
        return restore_word_marks(text, labels)
