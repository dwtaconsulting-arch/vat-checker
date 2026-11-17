from datetime import date
from fractions import Fraction

import pytest

from vat_calculator.core.params import ParamTable


def write(tmp_path, text, name="p.toml"):
    (tmp_path / name).write_text(text, encoding="utf-8")
    return tmp_path


def test_default_params_load():
    table = ParamTable.load_dir()
    rate = table.get("standard_rate", date(2026, 6, 30))
    assert rate.value == Fraction(1, 10)
    assert "제30조" in rate.basis


def test_selects_by_date(tmp_path):
    write(
        tmp_path,
        """
[[credit]]
value = "0.013"
effective_from = 2019-01-01
effective_to = 2026-12-31
basis = "old"

[[credit]]
value = "0.01"
effective_from = 2027-01-01
basis = "new"
""",
    )
    t = ParamTable.load_dir(tmp_path)
    assert t.get("credit", date(2026, 12, 31)).basis == "old"
    assert t.get("credit", date(2027, 1, 1)).value == Fraction(1, 100)
    with pytest.raises(LookupError):
        t.get("credit", date(2018, 12, 31))


def test_overlap_rejected(tmp_path):
    write(
        tmp_path,
        """
[[x]]
value = 1
effective_from = 2020-01-01
effective_to = 2025-12-31
basis = "a"

[[x]]
value = 2
effective_from = 2025-12-31
basis = "b"
""",
    )
    with pytest.raises(ValueError, match="겹침"):
        ParamTable.load_dir(tmp_path)


def test_float_value_rejected(tmp_path):
    write(tmp_path, '[[x]]\nvalue = 0.1\neffective_from = 2020-01-01\nbasis = "a"\n')
    with pytest.raises(ValueError, match="float"):
        ParamTable.load_dir(tmp_path)


def test_missing_field_rejected(tmp_path):
    write(tmp_path, '[[x]]\nvalue = 1\neffective_from = 2020-01-01\n')
    with pytest.raises(ValueError, match="basis"):
        ParamTable.load_dir(tmp_path)


def test_unknown_param(tmp_path):
    with pytest.raises(KeyError):
        ParamTable.load_dir(tmp_path).get("nope", date(2026, 1, 1))
