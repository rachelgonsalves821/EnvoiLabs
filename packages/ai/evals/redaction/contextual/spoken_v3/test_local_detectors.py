import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from local_detectors import LocalDetectors, MODEL_FILES, _require_full_model_input


class InputEncoding:
    def __init__(self, word_ids, token_count):
        self._words = word_ids
        self.input_ids = [[0] * token_count]

    def word_ids(self, _):
        return self._words


class TestTokenizer:
    model_max_length = 10

    def __init__(self, words, count):
        self._encoding = InputEncoding(words, count)

    def __call__(self, _input, *, is_split_into_words, truncation):
        if not is_split_into_words or truncation:
            raise AssertionError("The length check must see every token")
        return self._encoding


def model(max_words=5, word_ids=(None, 0, 1, 2), token_count=4):
    processor = SimpleNamespace(
        words_splitter=lambda text: [(word, 0, 0) for word in text.split()],
        prepare_inputs=lambda words, labels: ([[labels[0], *words[0]]], [1]),
        transformer_tokenizer=TestTokenizer(word_ids, token_count),
    )
    config = SimpleNamespace(max_len=max_words, encoder_config=SimpleNamespace(max_position_embeddings=8))
    return SimpleNamespace(data_processor=processor, config=config)


class LocalDetectorTests(unittest.TestCase):
    def test_requires_pinned_files_before_importing_inference(self):
        with TemporaryDirectory() as directory, self.assertRaises(ValueError):
            LocalDetectors(Path(directory))

    def test_rejects_changed_model_asset_before_importing_inference(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in MODEL_FILES:
                (root / name).touch()
            with self.assertRaisesRegex(ValueError, "asset differs"):
                LocalDetectors(root)

    def test_accepts_every_source_word_within_limits(self):
        _require_full_model_input(model(), "private address", ["address"])

    def test_rejects_word_limit_encoder_limit_and_missing_source_tokens(self):
        for detector in (model(max_words=1), model(token_count=9), model(word_ids=(None, 0, 1))):
            with self.subTest(detector=detector), self.assertRaises(ValueError):
                _require_full_model_input(detector, "private address", ["address"])
