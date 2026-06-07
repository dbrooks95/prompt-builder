import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from nodes.prompt_builder_node import PRESETS, _build_data


def test_build_data_accepts_multiple_subjects_from_payload_state():
    data = _build_data(
        {
            "prompt": "An intimate portrait of two lovers in a Victorian loft.",
            "subjects": [
                {
                    "description": "Iclandic brunette woman",
                    "position": "left center foreground",
                    "action": "lying on a bed",
                    "color_palette": ["#E8D5C4", "#36454F"],
                },
                {
                    "description": "Irish man",
                    "position": "right center foreground",
                    "action": "holding her hand",
                    "color_palette": ["#D7B899", "#1F2933"],
                },
            ],
            "colors": ["#E8D5C4", "#36454F"],
        }
    )

    assert len(data["subjects"]) == 2
    assert data["subjects"][0]["description"] == "Icelandic brunette woman"
    assert data["subjects"][1]["description"] == "Irish man"


def test_common_prompt_typos_are_cleaned_before_json_output():
    data = _build_data(
        {
            "prompt": "two iclandic people in a dimly lit victorion loft with alight coming from a balcony",
            "subjectDescription": "a Brunnette woman",
            "background": "dimly lit victorion loft with alight coming from a balcony covered in white drapes.",
        }
    )

    rendered = json.dumps(data)
    assert "iclandic" not in rendered.lower()
    assert "brunnette" not in rendered.lower()
    assert "victorion" not in rendered.lower()
    assert "Icelandic" in data["scene"]
    assert "brunette" in data["subjects"][0]["description"]
    assert "Victorian" in data["background"]


def test_retro_presets_exist_with_expected_camera_language():
    assert "crt_90s" in PRESETS
    assert "digicam_2000s" in PRESETS
    assert "CRT" in PRESETS["crt_90s"]["style"]
    assert "point-and-shoot" in PRESETS["digicam_2000s"]["camera"]["model"]


if __name__ == "__main__":
    tests = [
        test_build_data_accepts_multiple_subjects_from_payload_state,
        test_common_prompt_typos_are_cleaned_before_json_output,
        test_retro_presets_exist_with_expected_camera_language,
    ]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
