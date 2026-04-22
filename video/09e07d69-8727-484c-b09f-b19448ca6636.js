import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
dotenv.config();
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.GITHUB_OWNER;
const MEDIA_REPO = process.env.GITHUB_MEDIA_REPO;

export async function uploadFileToGithub(buffer, filename, folder = 'files') {
  const path = `${folder}/${filename}`;
  const content = buffer.toString('base64');
  let sha;
  try { const e = await octokit.repos.getContent({ owner: OWNER, repo: MEDIA_REPO, path }); sha = e.data.sha; } catch {}
  await octokit.repos.createOrUpdateFileContents({ owner: OWNER, repo: MEDIA_REPO, path, message: `Upload: ${filename}`, content, ...(sha ? { sha } : {}) });
  return { path, rawUrl: `https://raw.githubusercontent.com/${OWNER}/${MEDIA_REPO}/main/${path}`, repo: MEDIA_REPO };
}

export async function deleteFileFromGithub(filePath) {
  try {
    const { data } = await octokit.repos.getContent({ owner: OWNER, repo: MEDIA_REPO, path: filePath });
    await octokit.repos.deleteFile({ owner: OWNER, repo: MEDIA_REPO, path: filePath, message: `Delete: ${filePath}`, sha: data.sha });
    return true;
  } catch { return false; }
}
