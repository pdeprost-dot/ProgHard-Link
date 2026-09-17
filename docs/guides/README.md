# Getting Started PDF sources

`build_getting_started_guides.py` is the single maintainable source for the
French and English illustrated guides. Both editions share the same section
order, figures, figure numbers and layout; only the localized text differs.

From the repository root:

```text
python docs/guides/build_getting_started_guides.py
```

The generator requires Python, ReportLab and Pillow. It writes:

- `docs/ProgHard-Link-Guide-demarrage-FR.pdf`
- `docs/ProgHard-Link-Getting-Started-EN.pdf`

The native screenshots come from `docs/assets/screenshots/`. Update the shared
`FIGURES` list and both language dictionaries together when extending the
guide. Arduino and OTA are intentionally outside the current edition.
