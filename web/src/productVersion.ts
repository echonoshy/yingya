import history from '../../versions.json';

export const productVersion = history.releases[0].version;

type DevelopmentVersion = {
  version: string;
  date: string;
  title?: string;
  summary?: string;
};

export function releaseNotes(releases: readonly DevelopmentVersion[]) {
  return releases.filter((release): release is DevelopmentVersion & {title: string; summary: string} =>
    release.version.endsWith('.0') && Boolean(release.title?.trim()) && Boolean(release.summary?.trim()));
}

export const publicReleaseNotes = releaseNotes(history.releases);
