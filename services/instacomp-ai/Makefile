PYTHON := .venv/bin/python
PIP := .venv/bin/pip

.PHONY: setup run test validate-template

setup:
	python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt

run:
	./scripts/run-local.sh

test:
	$(PYTHON) -m compileall app scripts tests
	$(PYTHON) -m pytest -q

validate-template:
	$(PYTHON) scripts/validate_checklist.py checklists/checklist-template.csv
