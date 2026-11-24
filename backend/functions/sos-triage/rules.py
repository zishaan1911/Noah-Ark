"""Keyword triage of an SosReport: the offline fallback for sos-triage."""

import re

# Keyword -> need, English + Malay. Matched as substrings of the lower-cased text.
NEED_WORDS = {
    "water": ("water", "air minum", "thirsty", "dahaga"),
    "food": ("food", "makanan", "hungry", "lapar", "makan"),
    "medicine": ("medicine", "medication", "ubat", "insulin"),
    "baby_supplies": ("baby", "bayi", "infant", "formula", "susu"),
    "shelter": ("shelter", "tempat berteduh"),
    "rescue": ("trapped", "terperangkap", "injured", "cedera", "rescue", "tolong"),
}
FLOOD_WORDS = ("flood", "banjir", "air naik", "rising water", "roof", "bumbung", "atap")
CRITICAL_WORDS = ("insulin", "bleeding", "berdarah", "unconscious", "pengsan", "tidak sedar")
ELDERLY_WORDS = (
    "elderly",
    "warga emas",
    "nenek",
    "datuk",
    "atuk",
    "grandmother",
    "grandfather",
    "old man",
    "old woman",
)
CHILD_WORDS = ("baby", "bayi", "child", "children", "kanak", "anak")
CONDITIONS = {
    "insulin-dependent diabetes": ("insulin", "diabetes", "kencing manis"),
    "injury": ("injured", "cedera", "bleeding", "berdarah"),
    "trapped": ("trapped", "terperangkap"),
    "pregnancy": ("pregnant", "mengandung", "hamil"),
    "infant": ("baby", "bayi", "infant"),
    "elderly": ELDERLY_WORDS,
}


def _has(text: str, words: tuple[str, ...]) -> bool:
    return any(re.search(re.escape(w), text) for w in words)


# shortcut: keyword rules when Bedrock is unavailable (no AWS credentials locally); Bedrock is the real triage.
def triage_by_rules(report: dict) -> dict:
    """SosTriage for a report from keywords alone. Same shape as the Bedrock output."""
    medicines = [str(m) for m in report.get("medicines", [])]
    text = " ".join([str(report.get("rawMessage", "")), *medicines, *report.get("needs", [])]).lower()
    vulnerable = report.get("vulnerable") or {}

    needs = list(report.get("needs", []))
    for need, words in NEED_WORDS.items():
        if need not in needs and _has(text, words):
            needs.append(need)
    if medicines and "medicine" not in needs:
        needs.append("medicine")
    needs = needs or ["other"]

    flood = _has(text, FLOOD_WORDS)
    medicine = "medicine" in needs
    at_risk = (
        vulnerable.get("children", 0) > 0
        or vulnerable.get("elderly", 0) > 0
        or _has(text, ELDERLY_WORDS)
        or _has(text, CHILD_WORDS)
    )
    if (medicine and _has(text, CRITICAL_WORDS)) or (flood and at_risk):
        urgency = 5
    elif flood or medicine:
        urgency = 4
    elif "water" in needs or "food" in needs:
        urgency = 3
    else:
        urgency = 2

    conditions = list(dict.fromkeys(medicines))
    for label, words in CONDITIONS.items():
        if _has(text, words) and label not in conditions:
            conditions.append(label)

    people = report.get("peopleCount")
    who = f"{people} people" if people else "Sender"
    facts = []
    if flood:
        facts.append("in flood water or on a roof")
    if conditions:
        facts.append("with " + ", ".join(conditions))
    summary = f"{who} {' '.join(facts)}, needs {', '.join(needs)}; urgency {urgency} by keyword rules."
    out: dict = {
        "urgency": urgency,
        "needs": needs,
        "medicalConditions": conditions,
        "summary": summary[:1000],
        "language": report.get("language") or "en",
        "waterLanding": flood,
    }
    if people:
        out["peopleCount"] = people
    return out
