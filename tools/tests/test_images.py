import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare_images import prepare, source_info


class ImagesTest(unittest.TestCase):
    def test_reuse_corruption_and_changed_inputs(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root = Path(directory)
            raw = root / 'images/raw'
            raw.mkdir(parents=True)
            source = raw / 'test.png'
            Image.new('RGBA', (100, 150), (255, 0, 0, 128)).save(source)
            manifest = root / 'images/manifest.json'
            manifest.write_text(json.dumps({'images': [dict(id='test', file='test.png', alt='Test', **source_info(source))]}))
            recipe = root / 'images/recipes.json'
            recipe.write_text(json.dumps(dict(widths=[20, 40], quality=85, fullQuality=90)))
            first = prepare(root)
            outputs = list((root / 'images/processed').rglob('*.webp'))
            times = {p: p.stat().st_mtime_ns for p in outputs}
            self.assertEqual(prepare(root), first)
            self.assertEqual(times, {p: p.stat().st_mtime_ns for p in outputs})
            prepare(root, check=True)
            with Image.open(outputs[0]) as image:
                self.assertEqual(image.mode, 'RGBA')
                self.assertFalse(image.getexif())
            outputs[0].write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'corrupt'):
                prepare(root, check=True)
            prepare(root)
            prepare(root, check=True)
            recipe.write_text(json.dumps(dict(widths=[20, 40], quality=80, fullQuality=90)))
            changed = prepare(root)
            self.assertNotEqual(first['images'][0]['display'][0]['key'], changed['images'][0]['display'][0]['key'])
            Image.new('RGBA', (100, 150), (0, 255, 0, 128)).save(source)
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                prepare(root)
            changed_source = prepare(root, refresh=True)
            self.assertNotEqual(changed['images'][0]['full']['key'], changed_source['images'][0]['full']['key'])
            prepare(root, check=True)
            source.unlink()
            with self.assertRaisesRegex(ValueError, 'Missing raw'):
                prepare(root)

    def test_small_source_deduplicates_without_upscaling(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            root = Path(directory)
            raw = root / 'images/raw'
            raw.mkdir(parents=True)
            source = raw / 'test.png'
            Image.new('RGBA', (10, 15)).save(source)
            (root / 'images/manifest.json').write_text(json.dumps({'images': [dict(id='test', file='test.png', alt='Test', **source_info(source))]}))
            (root / 'images/recipes.json').write_text(json.dumps(dict(widths=[480, 960], quality=85, fullQuality=90)))
            result = prepare(root)['images'][0]
            self.assertEqual(len(result['variants']), 1)
            self.assertEqual(result['full']['width'], 10)


if __name__ == '__main__':
    unittest.main()
