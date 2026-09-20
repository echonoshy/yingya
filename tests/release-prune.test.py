"""Cleanup must never delete live snapshots or their shared dependencies."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[1] / 'scripts/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleasePruneTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.args = SimpleNamespace(data=root / 'data', runtime=root / 'runtime',
            releases=root / 'releases', env_file=root / '.env', keep=2, apply=False)
        deployment = self.args.data / 'deployment'
        deployment.mkdir(parents=True)
        self.args.releases.mkdir()
        for name in ['01-unused', '02-dependency', '03-transitive', '04-worker', '05-preview', '06-previous', '07-active', '08-new-build']:
            directory = self.args.releases / name
            directory.mkdir()
            (directory / 'release.json').write_text(json.dumps({'id': name,
                'binary': str(directory / 'yingya-server'), 'resources': str(directory)}))
        (self.args.releases / '09-incomplete').mkdir()
        (deployment / 'active.json').write_text(json.dumps({'release': '07-active', 'previous': '06-previous'}))
        (self.args.releases / '07-active/node_modules').symlink_to(self.args.releases / '02-dependency', target_is_directory=True)
        (self.args.releases / '02-dependency/shared').symlink_to(self.args.releases / '03-transitive', target_is_directory=True)
        registry = {'target': {'id': '07-active'}, 'workers': [{'release': '04-worker'}]}
        self.registry = patch.object(release.subprocess, 'check_output', return_value=json.dumps(registry)).start()
        patch.object(release, 'process_release_references', return_value={'05-preview'}).start()
        self.addCleanup(patch.stopall)

    def test_plan_protects_active_previous_workers_processes_recent_and_transitive_dependencies(self):
        self.assertEqual(release.prune_plan(self.args)['remove'], ['01-unused', '09-incomplete'])

    def test_dry_run_then_apply_leaves_protected_data_and_receipt(self):
        with contextlib.redirect_stdout(io.StringIO()):
            release.prune(self.args)
            self.assertTrue((self.args.releases / '01-unused').exists())
            self.args.apply = True
            release.prune(self.args)
        self.assertFalse((self.args.releases / '01-unused').exists())
        self.assertTrue((self.args.releases / '07-active/node_modules/shared/release.json').exists())
        receipt = next((self.args.data / 'deployment').glob('cleanup-*.json'))
        self.assertEqual(json.loads(receipt.read_text())['completed'], ['01-unused', '09-incomplete'])

    def test_registry_failure_does_not_remove_anything(self):
        self.registry.side_effect = subprocess.CalledProcessError(1, 'runtime-status')
        self.args.apply = True
        with self.assertRaises(subprocess.CalledProcessError):
            release.prune(self.args)
        self.assertTrue((self.args.releases / '01-unused').exists())

    def test_process_reference_cannot_confuse_release_name_prefixes(self):
        text = f'{self.args.releases}/abc-two/server\0{self.args.releases}/abc/node_modules'
        self.assertEqual(release.release_references(text, self.args.releases), {'abc', 'abc-two'})

    def test_root_symlink_is_not_a_deletion_candidate(self):
        outside = self.args.runtime
        outside.mkdir()
        (outside / 'keep').write_text('data')
        (self.args.releases / '00-link').symlink_to(outside, target_is_directory=True)
        self.assertNotIn('00-link', release.prune_plan(self.args)['remove'])

    def test_build_keeps_independent_binary_outside_shared_cargo_cache(self):
        source = Path(self.temp.name) / 'source'
        source.mkdir()
        for name in ['src', 'web', 'skills', 'scripts', 'runtime']:
            (source / name).mkdir()
        for name in ['Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json', 'tsconfig.json']:
            (source / name).write_text('{}')
        self.args.release = '10-new'
        cache_binary = self.args.runtime / 'release-build/release/yingya-server'

        def run(command, **kwargs):
            if command[0] == 'cargo':
                self.assertEqual(command[-2:], ['--target-dir', self.args.runtime / 'release-build'])
                cache_binary.parent.mkdir(parents=True)
                cache_binary.write_text('compiled snapshot')

        with patch.object(release, 'REPO', source), patch.object(release, 'run', side_effect=run), contextlib.redirect_stdout(io.StringIO()):
            release.build(self.args)
        cache_binary.write_text('later compilation')
        snapshot = self.args.releases / '10-new'
        self.assertEqual((snapshot / 'yingya-server').read_text(), 'compiled snapshot')
        self.assertFalse((snapshot / 'target').exists())
        self.assertEqual(json.loads((snapshot / 'release.json').read_text())['resources'], str(snapshot))


if __name__ == '__main__':
    unittest.main()
