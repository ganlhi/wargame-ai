import { useRef, useState, useCallback, useEffect } from 'react'
import { useGameStore } from '../stores/gameStore'

interface PhotoCaptureProps {
  onClose: () => void
}

export function PhotoCapture({ onClose }: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [corners, setCorners] = useState([
    { x: 0.05, y: 0.05 },
    { x: 0.95, y: 0.05 },
    { x: 0.95, y: 0.95 },
    { x: 0.05, y: 0.95 },
  ])
  const [dragCorner, setDragCorner] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imgSize, setImgSize] = useState({ w: 400, h: 300 })
  const setBackgroundImage = useGameStore((s) => s.setBackgroundImage)

  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 1920, height: 1080 },
        })
        streamRef.current = s
        setStream(s)
        if (videoRef.current) {
          videoRef.current.srcObject = s
        }
      } catch {
        // Camera not available
      }
    }
    startCamera()
    return () => {
      const s = streamRef.current
      if (s) s.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = captureCanvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
    setPhoto(dataUrl)
    setCorners([
      { x: 0.05, y: 0.05 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ])
    const s = streamRef.current
    if (s) s.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
  }, [])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onload = () => {
        setPhoto(dataUrl)
        setCorners([
          { x: 0.05, y: 0.05 },
          { x: 0.95, y: 0.05 },
          { x: 0.95, y: 0.95 },
          { x: 0.05, y: 0.95 },
        ])
        const s = streamRef.current
        if (s) s.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        setStream(null)
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const retake = useCallback(() => {
    const old = streamRef.current
    if (old) old.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
    setPhoto(null)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: 1920, height: 1080 } })
      .then((s) => {
        streamRef.current = s
        setStream(s)
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => {})
  }, [])

  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (!img) return
    if (img.naturalWidth) {
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
    } else {
      const onLoad = () => {
        setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
        img.removeEventListener('load', onLoad)
      }
      img.addEventListener('load', onLoad)
    }
  }, [])

  const applyTransform = useCallback(() => {
    const srcCanvas = captureCanvasRef.current
    const dstCanvas = previewRef.current
    if (!srcCanvas || !dstCanvas) return

    const game = useGameStore.getState().currentGame
    if (!game) return

    const destW = game.tableWidth
    const destH = game.tableHeight
    dstCanvas.width = destW
    dstCanvas.height = destH

    const ctx = dstCanvas.getContext('2d')
    if (!ctx) return

    const srcW = srcCanvas.width
    const srcH = srcCanvas.height

    const src = corners.map((c) => ({
      x: c.x * srcW,
      y: c.y * srcH,
    }))
    const minX = Math.max(0, Math.min(...src.map(p => p.x)))
    const minY = Math.max(0, Math.min(...src.map(p => p.y)))
    const maxX = Math.min(srcW, Math.max(...src.map(p => p.x)))
    const maxY = Math.min(srcH, Math.max(...src.map(p => p.y)))
    ctx.drawImage(srcCanvas, minX, minY, maxX - minX, maxY - minY, 0, 0, destW, destH)

    const result = dstCanvas.toDataURL('image/jpeg', 0.85)
    setBackgroundImage(result)
    onClose()
  }, [corners, onClose, setBackgroundImage])

  const handlePointerDown = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    setDragCorner(index)
  }

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragCorner === null || imgSize.w < 100) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const divX = (e.clientX - rect.left) / rect.width
      const divY = (e.clientY - rect.top) / rect.height
      const scale = Math.min(rect.width / imgSize.w, rect.height / imgSize.h)
      const ox = (rect.width - imgSize.w * scale) / 2
      const oy = (rect.height - imgSize.h * scale) / 2
      const imgX = ((divX * rect.width - ox) / scale) / imgSize.w
      const imgY = ((divY * rect.height - oy) / scale) / imgSize.h
      setCorners((prev) => {
        const next = [...prev]
        next[dragCorner] = {
          x: Math.max(0, Math.min(1, imgX)),
          y: Math.max(0, Math.min(1, imgY)),
        }
        return next
      })
    },
    [dragCorner, imgSize]
  )

  const handlePointerUp = useCallback(() => {
    setDragCorner(null)
  }, [])

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Table Photo</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-sm cursor-pointer">Skip</button>
        </div>

        <div className="p-4 space-y-4">
          {!photo ? (
            <div className="space-y-3">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full rounded-lg bg-gray-800"
                style={{ maxHeight: 400, objectFit: 'contain' }}
              />
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={capture}
                  disabled={!stream}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Capture Photo
                </button>
                <label className="bg-gray-700 hover:bg-gray-600 text-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer">
                  Upload Image
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div
                className="relative select-none"
                style={{ maxHeight: 400 }}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                <img
                  ref={imgRef}
                  src={photo}
                  alt="Captured table"
                  className="w-full rounded-lg"
                  style={{ maxHeight: 350, objectFit: 'contain' }}
                  draggable={false}
                />
                <canvas ref={previewRef} className="hidden" />
                {imgSize.w >= 100 && (
                <svg
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  viewBox={`0 0 ${imgSize.w} ${imgSize.h}`}
                  preserveAspectRatio="xMidYMid meet"
                >
                  <polygon
                    points={corners
                      .map((c) => `${(c.x * imgSize.w).toFixed(1)},${(c.y * imgSize.h).toFixed(1)}`)
                      .join(' ')}
                    fill="rgba(59,130,246,0.15)"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                  />
                  {corners.map((c, i) => (
                    <circle
                      key={i}
                      cx={c.x * imgSize.w}
                      cy={c.y * imgSize.h}
                      r={10}
                      fill="#3b82f6"
                      stroke="#fff"
                      strokeWidth={2}
                      className="pointer-events-auto"
                      style={{ cursor: 'grab' }}
                      onPointerDown={handlePointerDown(i)}
                    />
                  ))}
                </svg>
                )}
              </div>
              <p className="text-xs text-gray-500 text-center">
                Drag corners to align with table edges, then Apply.
              </p>
              <div className="flex gap-2">
                <button onClick={retake} className="text-gray-400 hover:text-gray-200 px-3 py-2 text-sm transition-colors cursor-pointer">
                  Retake
                </button>
                <button
                  onClick={applyTransform}
                  className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  Apply as Background
                </button>
              </div>
            </div>
          )}
          <canvas ref={captureCanvasRef} className="hidden" />
        </div>
      </div>
    </div>
  )
}


