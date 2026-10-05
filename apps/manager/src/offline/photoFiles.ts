import ReactNativeBlobUtil from 'react-native-blob-util';

const DIR = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/pending-photos`;

function toPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

/**
 * The camera writes to a cache folder Android may clear at any time, so a photo waiting for
 * signal is copied somewhere that survives until its upload lands.
 */
export async function keepLocalCopy(uri: string, id: string, ext: string): Promise<string> {
  const { fs } = ReactNativeBlobUtil;
  if (!(await fs.isDir(DIR))) await fs.mkdir(DIR);
  const dest = `${DIR}/${id}.${ext}`;
  if (await fs.exists(dest)) await fs.unlink(dest);
  await fs.cp(toPath(uri), dest);
  return `file://${dest}`;
}

/** False when a file the outbox still needs has gone (e.g. Android cleared the cache). */
export async function localFileExists(uri: string): Promise<boolean> {
  if (!uri.startsWith('file://') && !uri.startsWith('/')) return true; // content:// etc.
  try {
    return await ReactNativeBlobUtil.fs.exists(toPath(uri));
  } catch {
    return true; // Can't tell; let the upload try.
  }
}

export async function deleteLocalCopy(uri: string): Promise<void> {
  const path = toPath(uri);
  if (!path.startsWith(DIR)) return;
  try {
    await ReactNativeBlobUtil.fs.unlink(path);
  } catch {
    // Already gone.
  }
}
