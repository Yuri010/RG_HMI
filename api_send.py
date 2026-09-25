"""
Python script that can send Fanuc KCL requests.
* Requires KCL/Karel permissions over HTTP
"""
import re
from typing import Optional

import requests

COMSET_URL = "http://127.0.0.1/karel/ComSet"
NUMREG_URL = "http://127.0.0.1/MD/NUMREG.VA"


def get_reg(reg_index: Optional[int] = None):
    """Fetch data from the numerical registry"""
    try:
        response = requests.get(NUMREG_URL, timeout=10)
        if response.status_code == 200:
            registry = {
                int(register): _parse_register_value(value)
                for register, value in re.findall(
                    r"\[(\d+)\]\s*=\s*([-+]?\d+(?:\.\d+)?)", response.text
                )
            }
            if reg_index is None:
                return registry
            if reg_index not in registry:
                raise ValueError(f"Registry number must be between 1 and 200: {reg_index}")
            return registry[reg_index]
        else:
            raise requests.HTTPError(
                f"Server responded with status code: {response.status_code}"
            )
    except requests.exceptions.RequestException as e:
        print(f"Connection error: {e}")
        return None


def _parse_register_value(value: str):
    """Return integer register values as ints and decimal values as floats."""
    number = float(value)
    return int(number) if number.is_integer() else number


def write_reg(reg_index: int, waarde: int):
    """Write a numerical value to the registry"""
    payload = {
        "sValue": f"{waarde}",
        "sIndx": f"{reg_index}",
        "sFc": "2",
        "sRealFlag": "-1"  # -1 for Integer, 1 for Float
    }
    try:
        response = requests.get(COMSET_URL, params=payload, timeout=10)
        if response.status_code == 200:
            print(f"Set (S)R[{reg_index}] to '{waarde}'")
        else:
            print(f"Failed to set registry value:\n\
                  Server responded with status code: {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"Connection error: {e}")
        return


# get_reg(1) returns the value of R[1].
# get_reg() returns all parsed numerical registers.
# write_reg(1, 16) writes value '16' to R[1].
