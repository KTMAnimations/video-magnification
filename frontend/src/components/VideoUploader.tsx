import { useRef, useState, useCallback } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Upload, Camera, CameraOff } from 'lucide-react';

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
      <Card
        className={`w-full max-w-xl border-2 border-dashed cursor-pointer transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
        }`}
      >
        <CardContent
          className="flex flex-col items-center justify-center py-12 px-6"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          {preview ? (
            <div className="w-full">
              <div className="dark-panel-deep p-2">
                <video
                  src={preview}
                  className="max-h-48 mx-auto rounded"
                  controls
                  muted
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-muted-foreground">
                <span>{fileInfo?.name}</span>
                <span>{fileInfo?.size}</span>
              </div>
            </div>
          ) : (
            <>
              <Upload className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <div className="text-sm text-foreground">
                Drop video file here or click to browse
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Any format OpenCV supports (mp4, avi, mov, ...)
              </div>
            </>
          )}
        </CardContent>
      </Card>

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

      {showCameraButton && (
        <Button variant="outline" onClick={onCameraToggle} className="gap-2">
          {cameraActive ? (
            <>
              <CameraOff className="h-4 w-4" />
              Stop Camera
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" />
              Use Camera
            </>
          )}
        </Button>
      )}
    </div>
  );
}
