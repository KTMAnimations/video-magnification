import { useRef, useState, useCallback } from 'react';

interface Props {
  onFileSelect: (file: File) => void;
  onCameraToggle: () => void;
  cameraActive: boolean;
  showCameraButton?: boolean;
}

export function VideoUploader({ onFileSelect, onCameraToggle, cameraActive, showCameraButton = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; size: string } | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setPreview(URL.createObjectURL(file));
      setFileInfo({
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
      });
      onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`w-full max-w-xl border-2 border-dashed rounded cursor-pointer transition-all flex flex-col items-center justify-center py-12 px-6 ${
          dragOver
            ? 'border-[var(--color-accent)] bg-[var(--color-accent-glow)]'
            : 'border-[var(--color-border-bright)] hover:border-[var(--color-text-dim)]'
        }`}
      >
        {preview ? (
          <div className="w-full">
            <video
              src={preview}
              className="max-h-48 mx-auto rounded"
              controls
              muted
            />
            <div className="flex justify-between mt-2 text-[0.65rem] text-[var(--color-text-dim)]">
              <span>{fileInfo?.name}</span>
              <span>{fileInfo?.size}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="text-3xl text-[var(--color-text-dim)] mb-2">&#9655;</div>
            <div className="text-[0.75rem] text-[var(--color-text-secondary)]">
              Drop video file here or click to browse
            </div>
            <div className="text-[0.6rem] text-[var(--color-text-dim)] mt-1">
              Any format OpenCV supports (mp4, avi, mov, ...)
            </div>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {/* Camera toggle (real-time mode only) */}
      {showCameraButton && (
        <button onClick={onCameraToggle} className="btn-secondary flex items-center gap-2">
          <span className={cameraActive ? 'text-[var(--color-accent)]' : ''}>
            &#9673;
          </span>
          {cameraActive ? 'Stop Camera' : 'Use Camera'}
        </button>
      )}
    </div>
  );
}
