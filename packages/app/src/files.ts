/** Browser file helpers: save bytes/text as a download, and pick a local file. */

export function download(name: string, data: Uint8Array | string, mime: string): void {
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([part], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the browser file picker; resolves with the chosen file, or undefined if cancelled. */
export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(undefined);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
