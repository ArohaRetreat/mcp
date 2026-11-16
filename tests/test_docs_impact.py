import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from check_docs_impact import has_decision


class DocumentationImpactTests(unittest.TestCase):
    def test_decision_must_appear_in_visible_impact_section(self):
        heading = '## Documentation impact\n\n'
        for decision in ['Updated: Product handbook', 'No change: Internal refactor']:
            self.assertTrue(has_decision((heading + decision).replace('\n', '\r\n')))
        for body in [
            heading + '<!-- Updated: mention guides here -->',
            heading + 'Updated: ',
            heading + '~~~md\nNo change: example\n~~~',
            heading + '## Testing\nUpdated: Unit tests',
            'Updated: Product handbook',
        ]:
            self.assertFalse(has_decision(body), body)

    def test_ci_reads_pr_event(self):
        with tempfile.TemporaryDirectory() as scratch:
            event = Path(scratch) / 'event.json'
            for body, code in [(None, 1), ('## Documentation impact\nUpdated: Settings guide', 0)]:
                event.write_text(json.dumps({'pull_request': {'body': body}}))
                result = subprocess.run(
                    [sys.executable, ROOT / 'scripts/check_docs_impact.py'],
                    env={**os.environ, 'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_EVENT_PATH': str(event)},
                    capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, code, result.stderr)
