"""Tests for resilient_util.py"""

import json
import os
import tempfile

import pytest

from resilient_util import (
    FileError,
    ParseError,
    RetryExhausted,
    UtilityError,
    compute_stats,
    safe_divide,
    safe_divide_retried,
    safe_merge_dicts,
    safe_parse_json,
    safe_read_file,
    safe_write_file,
    retry,
)


# --- safe_divide ---

class TestSafeDivide:
    def test_normal_division(self):
        assert safe_divide(10, 2) == 5.0

    def test_zero_denominator(self):
        assert safe_divide(10, 0) == 0.0

    def test_float_division(self):
        assert safe_divide(7, 2) == 3.5

    def test_zero_result(self):
        assert safe_divide(0, 5) == 0.0

    def test_type_error(self):
        with pytest.raises(TypeError):
            safe_divide("10", 2)

    def test_negative_numbers(self):
        assert safe_divide(-10, 2) == -5.0


# --- safe_parse_json ---

class TestSafeParseJson:
    def test_valid_json_object(self):
        result = safe_parse_json('{"key": "value"}')
        assert result == {"key": "value"}

    def test_valid_json_array(self):
        result = safe_parse_json('[1, 2, 3]')
        assert result == [1, 2, 3]

    def test_invalid_json(self):
        with pytest.raises(ParseError):
            safe_parse_json('{"bad json}')

    def test_empty_string(self):
        with pytest.raises(ParseError):
            safe_parse_json("")


# --- safe_read_file / safe_write_file ---

class TestFileOps:
    def test_write_and_read(self, tmp_path):
        filepath = str(tmp_path / "test.txt")
        content = "Hello, World!"
        assert safe_write_file(filepath, content) is True
        result = safe_read_file(filepath)
        assert result == content

    def test_read_missing_file(self):
        result = safe_read_file("/nonexistent/file.txt")
        assert result is None

    def test_write_overwrite(self, tmp_path):
        filepath = str(tmp_path / "overwrite.txt")
        assert safe_write_file(filepath, "first") is True
        assert safe_write_file(filepath, "second") is True
        assert safe_read_file(filepath) == "second"

    def test_write_no_overwrite(self, tmp_path):
        filepath = str(tmp_path / "nooverwrite.txt")
        safe_write_file(filepath, "first", overwrite=False)
        assert safe_read_file(filepath) == "first"

    def test_file_error_on_oserror(self):
        with pytest.raises(FileError):
            safe_read_file("/root/protected/file.txt")


# --- retry decorator ---

class TestRetry:
    def test_successful_after_failures(self):
        call_count = 0

        @retry(max_attempts=3, delay=0.01)
        def sometimes_fails():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("Not yet")
            return "success"

        result = sometimes_fails()
        assert result == "success"
        assert call_count == 3

    def test_all_attempts_fail(self):
        @retry(max_attempts=2, delay=0.01)
        def always_fails():
            raise ValueError("Always fails")

        with pytest.raises(RetryExhausted):
            always_fails()

    def test_immediate_success(self):
        call_count = 0

        @retry(max_attempts=3, delay=0.01)
        def always_succeeds():
            nonlocal call_count
            call_count += 1
            return "ok"

        result = always_succeeds()
        assert result == "ok"
        assert call_count == 1


# --- compute_stats ---

class TestComputeStats:
    def test_normal_list(self):
        result = compute_stats([1, 2, 3, 4, 5])
        assert result["mean"] == 3.0
        assert result["min"] == 1
        assert result["max"] == 5
        assert result["count"] == 5

    def test_empty_list(self):
        result = compute_stats([])
        assert result == {"mean": 0.0, "min": 0.0, "max": 0.0, "count": 0}

    def test_single_element(self):
        result = compute_stats([42])
        assert result["mean"] == 42.0
        assert result["min"] == 42
        assert result["max"] == 42
        assert result["count"] == 1


# --- safe_merge_dicts ---

class TestSafeMergeDicts:
    def test_merge_multiple_dicts(self):
        result = safe_merge_dicts(
            {"a": 1},
            {"b": 2},
            {"c": 3},
        )
        assert result == {"a": 1, "b": 2, "c": 3}

    def test_last_wins(self):
        result = safe_merge_dicts(
            {"a": 1, "b": 2},
            {"b": 3, "c": 4},
        )
        assert result == {"a": 1, "b": 3, "c": 4}

    def test_empty_merge(self):
        result = safe_merge_dicts()
        assert result == {}

    def test_type_error_on_non_dict(self):
        with pytest.raises(TypeError):
            safe_merge_dicts({"a": 1}, "not_a_dict")


# --- Exception hierarchy ---

class TestExceptionHierarchy:
    def test_utility_error_base(self):
        assert issubclass(UtilityError, Exception)

    def test_file_error_is_utility_error(self):
        assert issubclass(FileError, UtilityError)

    def test_parse_error_is_utility_error(self):
        assert issubclass(ParseError, UtilityError)

    def test_retry_exhausted_is_utility_error(self):
        assert issubclass(RetryExhausted, UtilityError)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
