import history from '../../versions.json';

export const productVersion = history.releases[0].version;

type DevelopmentVersion = {
  version: string;
  date: string;
  changes: readonly string[];
};

export function releaseNotes(releases: readonly DevelopmentVersion[]) {
  return releases.filter(release => !release.version.endsWith('.0')).slice(0, 5)
    .map(({version, date, changes}) => ({version, date, summary: changes.join(' ')}));
}

export const publicReleaseNotes = releaseNotes(history.releases);
