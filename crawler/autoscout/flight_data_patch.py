from types import SimpleNamespace

from njsparser.parser import flight_data


def tolerate_empty_flight_data_rows() -> None:
    original = flight_data.orjson
    if getattr(original, 'tolerates_empty_rows', False):
        return

    flight_data.orjson = SimpleNamespace(
        loads=lambda raw_value: original.loads(raw_value) if raw_value else None,
        JSONDecodeError=original.JSONDecodeError,
        tolerates_empty_rows=True)
