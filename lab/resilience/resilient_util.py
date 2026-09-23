"""
resilient_util.py - A small resilient Python utility with clear error handling.

Provides safe file operations, safe division, and safe JSON parsing with
retry logic and comprehensive error classification.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

# Configure logging
logger = logging.getLogger(__name__)


class UtilityError(Exception):
    """Base exception for the utility module."""
    pass


class FileError(UtilityError):
    """Raised when a file operation fails."""
    pass


class ParseError(UtilityError):
    """Raised when data parsing fails."""
    pass


class RetryExhausted(UtilityError):
    """Raised when all retry attempts are exhausted."""
    pass


def safe_divide(a: Union[int, float], b: Union[int, float]) -> float:
    """Safely divide two numbers, returning 0.0 on zero division.

    Args:
        a: Numerator.
        b: Denominator.

    Returns:
        The result of a / b, or 0.0 if b is zero.

    Raises:
        TypeError: If inputs are not numeric.
    """
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError(f"Expected numeric types, got {type(a).__name__} and {type(b).__name__}")
    try:
        return a / b
    except ZeroDivisionError:
        logger.warning("Division by zero: %s / %s", a, b)
        return 0.0


def safe_read_file(filepath: str, encoding: str = "utf-8") -> Optional[str]:
    """Safely read a file's content.

    Args:
        filepath: Path to the file.
        encoding: File encoding.

    Returns:
        File content as string, or None if file not found.

    Raises:
        FileError: If an unexpected error occurs.
    """
    try:
        path = Path(filepath)
        if not path.exists():
            logger.warning("File not found: %s", filepath)
            return None
        content = path.read_text(encoding=encoding)
        return content
    except OSError as e:
        logger.error("OS error reading file %s: %s", filepath, e)
        raise FileError(f"Failed to read {filepath}: {e}")
    except Exception as e:
        logger.error("Unexpected error reading file %s: %s", filepath, e)
        raise FileError(f"Failed to read {filepath}: {e}")


def safe_parse_json(json_string: str) -> Optional[Union[Dict, List]]:
    """Safely parse a JSON string.

    Args:
        json_string: A valid JSON string.

    Returns:
        Parsed JSON as dict or list, or None on failure.

    Raises:
        ParseError: If JSON parsing fails.
    """
    try:
        result = json.loads(json_string)
        return result
    except json.JSONDecodeError as e:
        logger.error("Invalid JSON: %s", e)
        raise ParseError(f"Invalid JSON string: {e}")


def safe_write_file(
    filepath: str,
    content: str,
    encoding: str = "utf-8",
    overwrite: bool = True,
) -> bool:
    """Safely write content to a file.

    Args:
        filepath: Path to the file.
        content: Content to write.
        encoding: File encoding.
        overwrite: Whether to overwrite existing file.

    Returns:
        True if write succeeded, False if file exists and overwrite=False.

    Raises:
        FileError: If write fails.
    """
    try:
        path = Path(filepath)
        if path.exists() and not overwrite:
            logger.info("File exists, skipping: %s", filepath)
            return False
        path.write_text(content, encoding=encoding)
        logger.info("Wrote %d bytes to %s", len(content.encode(encoding)), filepath)
        return True
    except OSError as e:
        logger.error("OS error writing file %s: %s", filepath, e)
        raise FileError(f"Failed to write {filepath}: {e}")


def retry(max_attempts: int = 3, delay: float = 0.1, backoff: float = 2.0):
    """Decorator to retry a function on exception.

    Args:
        max_attempts: Maximum number of attempts.
        delay: Initial delay between retries in seconds.
        backoff: Multiplier for delay after each attempt.
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            last_exception = None
            current_delay = delay
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    logger.warning(
                        "Attempt %d/%d failed for %s: %s",
                        attempt, max_attempts, func.__name__, e,
                    )
                    if attempt < max_attempts:
                        time.sleep(current_delay)
                        current_delay *= backoff
            raise RetryExhausted(
                f"All {max_attempts} attempts for {func.__name__} failed"
            ) from last_exception
        return wrapper
    return decorator


@retry(max_attempts=3, delay=0.1)
def safe_divide_retried(a: Union[int, float], b: Union[int, float]) -> float:
    """Safely divide with retry logic.

    Args:
        a: Numerator.
        b: Denominator.

    Returns:
        The result of a / b.

    Raises:
        TypeError: If inputs are not numeric.
        RetryExhausted: If all retry attempts fail.
    """
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        raise TypeError(f"Expected numeric types")
    if b == 0:
        raise ZeroDivisionError("Division by zero")
    return a / b


def compute_stats(numbers: List[Union[int, float]]) -> Dict[str, float]:
    """Compute basic statistics for a list of numbers.

    Args:
        numbers: List of numbers.

    Returns:
        Dictionary with 'mean', 'min', 'max', 'count'.
    """
    if not numbers:
        return {"mean": 0.0, "min": 0.0, "max": 0.0, "count": 0}
    return {
        "mean": sum(numbers) / len(numbers),
        "min": min(numbers),
        "max": max(numbers),
        "count": len(numbers),
    }


def safe_merge_dicts(*dicts: Dict[str, Any]) -> Dict[str, Any]:
    """Safely merge multiple dictionaries (last one wins).

    Args:
        *dicts: Dictionaries to merge.

    Returns:
        Merged dictionary.
    """
    result = {}
    for d in dicts:
        if not isinstance(d, dict):
            raise TypeError(f"Expected dict, got {type(d).__name__}")
        result.update(d)
    return result
