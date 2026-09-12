/**
 * A thin client for the parts of the Google Drive v3 REST API the sync uses:
 * walking the user's folders and reading, writing and deleting small JSON
 * files in one of them. Plain `fetch`, no Google SDK — the whole surface is a
 * handful of endpoints, and keeping it explicit makes it easy to fake in tests.
 */

export interface DriveFolder {
  id: string
  name: string
}

export interface DriveFileMeta {
  id: string
  name: string
}

export interface DriveClient {
  /** Immediate subfolders of `parentId`, by name. `'root'` is My Drive. */
  listFolders(parentId: string): Promise<DriveFolder[]>
  createFolder(parentId: string, name: string): Promise<DriveFolder>
  /** Every non-folder file directly inside `folderId`. */
  listFiles(folderId: string): Promise<DriveFileMeta[]>
  downloadJson(fileId: string): Promise<unknown>
  /**
   * Write `data` as JSON. Updates `existingId` in place when given (throwing a
   * 404 `DriveApiError` if it has gone), otherwise creates a new file in
   * `folderId`. Resolves with the file's id either way.
   */
  uploadJson(folderId: string, name: string, data: unknown, existingId?: string): Promise<string>
  deleteFile(fileId: string): Promise<void>
}

export class DriveApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DriveApiError'
    this.status = status
  }
}

export const ROOT_FOLDER: DriveFolder = { id: 'root', name: 'My Drive' }
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * `getToken` is asked for a bearer token on every request, so a token that is
 * refreshed between calls is picked up without rebuilding the client.
 */
export function createDriveClient(
  getToken: () => Promise<string>,
  fetchFn: FetchLike = (input, init) => fetch(input, init),
): DriveClient {
  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const token = await getToken()
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      Authorization: `Bearer ${token}`,
    }
    const res = await fetchFn(url, { ...init, headers })
    if (!res.ok) {
      let message = `Google Drive returned ${res.status}`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        if (body?.error?.message) message = body.error.message
      } catch {
        // Not a JSON error body; the status is all we have.
      }
      throw new DriveApiError(res.status, message)
    }
    return res
  }

  const listAll = async <T>(q: string, fields: string): Promise<T[]> => {
    const out: T[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q,
        fields: `nextPageToken, files(${fields})`,
        pageSize: '1000',
        orderBy: 'name',
        spaces: 'drive',
      })
      if (pageToken) params.set('pageToken', pageToken)
      const page = (await (await request(`${API}/files?${params}`)).json()) as {
        files?: T[]
        nextPageToken?: string
      }
      out.push(...(page.files ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return out
  }

  return {
    listFolders: (parentId) =>
      listAll<DriveFolder>(
        `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        'id, name',
      ),

    createFolder: async (parentId, name) => {
      const res = await request(`${API}/files?fields=id,name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
      })
      return (await res.json()) as DriveFolder
    },

    listFiles: (folderId) =>
      listAll<DriveFileMeta>(
        `'${folderId}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`,
        'id, name',
      ),

    downloadJson: async (fileId) => (await request(`${API}/files/${fileId}?alt=media`)).json(),

    uploadJson: async (folderId, name, data, existingId) => {
      const content = JSON.stringify(data)
      if (existingId) {
        const res = await request(`${UPLOAD_API}/files/${existingId}?uploadType=media&fields=id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: content,
        })
        return ((await res.json()) as { id: string }).id
      }
      // Creating a file with both a name and content takes a multipart body:
      // one part of metadata, one of content.
      const boundary = `wargame-ai-${Math.random().toString(36).slice(2)}`
      const metadata = JSON.stringify({ name, mimeType: 'application/json', parents: [folderId] })
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
        `--${boundary}--`
      const res = await request(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      })
      return ((await res.json()) as { id: string }).id
    },

    deleteFile: async (fileId) => {
      await request(`${API}/files/${fileId}`, { method: 'DELETE' })
    },
  }
}
