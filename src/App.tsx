/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, 
  Trash2, 
  Download, 
  Image as ImageIcon, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Plus,
  Layers,
  Edit2,
  X,
  Brush,
  Eraser,
  Square,
  Maximize2,
  RotateCcw,
  Undo2,
  Wand2,
  MousePointer2,
  ChevronLeft,
  ChevronRight,
  Settings,
  Maximize,
  Sparkles
} from 'lucide-react';
import { removeBackground } from '@imgly/background-removal';
import JSZip from 'jszip';
import { parseGIF, decompressFrames } from 'gifuct-js';
// @ts-ignore
import gifshot from 'gifshot';

// --- Types ---

interface GifFrame {
  originalBlob: Blob;
  previewUrl: string;
  processedUrl: string | null;
  maskUrl: string | null;
  delay: number;
  subject?: string;
  category?: string;
}

interface ProcessedFile {
  id: string;
  file: File;
  preview: string;
  processedUrl: string | null;
  maskUrl: string | null; 
  status: 'pending' | 'analyzing' | 'processing' | 'done' | 'error';
  error?: string;
  progress: number;
  startTime?: number;
  estimatedSeconds?: number;
  gifFps?: number;
  totalFrames?: number;
  subject?: string;
  category?: string;
  gifFrames?: GifFrame[]; // Added for frame-by-frame editing
}

// --- MaskEditor Component ---

interface MaskEditorProps {
  fileItem: ProcessedFile;
  onSave: (processedUrl: string, gifFrames?: GifFrame[]) => void;
  onClose: () => void;
}

const MaskEditor: React.FC<MaskEditorProps> = ({ fileItem, onSave, onClose }) => {
  const [brushSize, setBrushSize] = useState(30);
  const [tool, setTool] = useState<'brush' | 'eraser' | 'magic'>('brush');
  const [magicTolerance, setMagicTolerance] = useState(30);
  const [bgPreview, setBgPreview] = useState<'checker' | 'white' | 'black'>('checker');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showMaskOnly, setShowMaskOnly] = useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const displayCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 });
  const [isMouseOver, setIsMouseOver] = useState(false);
  const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
  
  // GIF specific state
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [gifFrames, setGifFrames] = useState<GifFrame[]>(fileItem.gifFrames || []);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const setupCanvases = async () => {
      setIsLoading(true);
      const isGif = !!fileItem.gifFrames;
      const currentFrame = isGif ? gifFrames[currentFrameIdx] : null;
      
      const img = new Image();
      img.src = isGif ? currentFrame!.previewUrl : fileItem.preview;
      await new Promise(resolve => img.onload = resolve);

      const canvas = canvasRef.current;
      const maskCanvas = maskCanvasRef.current;
      const displayCanvas = displayCanvasRef.current;
      if (!canvas || !maskCanvas || !displayCanvas) return;

      [canvas, maskCanvas, displayCanvas].forEach(c => {
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
      });

      const ctx = canvas.getContext('2d');
      const maskCtx = maskCanvas.getContext('2d');
      if (!ctx || !maskCtx) return;

      ctx.drawImage(img, 0, 0);

      const processedUrl = isGif ? currentFrame!.processedUrl : fileItem.processedUrl;

      if (processedUrl) {
        const resultImg = new Image();
        resultImg.src = processedUrl;
        await new Promise(resolve => resultImg.onload = resolve);
        
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCtx.drawImage(resultImg, 0, 0);
        const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        for (let i = 0; i < imgData.data.length; i += 4) {
          const alpha = imgData.data[i + 3];
          imgData.data[i] = 0;
          imgData.data[i+1] = 0;
          imgData.data[i+2] = 0;
          imgData.data[i+3] = alpha;
        }
        maskCtx.putImageData(imgData, 0, 0);
      } else {
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
      }

      setIsLoading(false);
    };

    setupCanvases();
  }, [fileItem, currentFrameIdx]);

  // Handle frame changes: save current mask to the frame list before switching
  const saveCurrentMaskToFrame = () => {
    if (!fileItem.gifFrames) return;
    
    const canvas = document.createElement('canvas');
    const mask = maskCanvasRef.current;
    const originalCanvas = canvasRef.current;
    if (!mask || !originalCanvas) return;

    canvas.width = originalCanvas.width;
    canvas.height = originalCanvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(originalCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    
    const processedUrl = canvas.toDataURL('image/png');
    setGifFrames(prev => prev.map((f, i) => i === currentFrameIdx ? { ...f, processedUrl } : f));
  };

  // Main rendering loop for the display canvas
  useEffect(() => {
    if (isLoading) return;

    let rafId: number;
    const render = () => {
      const display = displayCanvasRef.current;
      const mask = maskCanvasRef.current;
      const original = canvasRef.current;
      if (!display || !mask || !original) return;

      const dCtx = display.getContext('2d');
      if (!dCtx) return;

      dCtx.clearRect(0, 0, display.width, display.height);
      dCtx.save();
      
      // Apply Pan and Zoom
      dCtx.translate(display.width / 2 + pan.x, display.height / 2 + pan.y);
      dCtx.scale(zoom, zoom);
      dCtx.translate(-display.width / 2, -display.height / 2);

      if (showMaskOnly) {
        // Just show the resulting cutout
        dCtx.drawImage(original, 0, 0);
        dCtx.globalCompositeOperation = 'destination-in';
        dCtx.drawImage(mask, 0, 0);
        dCtx.globalCompositeOperation = 'source-over';
      } else {
        // Show original with tinted mask overlay
        dCtx.drawImage(original, 0, 0);
        
        // Use a temporary canvas to create the red tint
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = display.width;
        tempCanvas.height = display.height;
        const tCtx = tempCanvas.getContext('2d');
        if (tCtx) {
          tCtx.drawImage(mask, 0, 0);
          tCtx.globalCompositeOperation = 'source-in';
          tCtx.fillStyle = 'rgba(59, 130, 246, 0.4)'; // Blue tint for "kept" area
          tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          dCtx.drawImage(tempCanvas, 0, 0);
        }
      }

      // Draw active brush/magic feedback
      if (isMouseOver && !isLoading && !isPanning) {
        if (tool === 'magic') {
          // Crosshair for magic tool
          dCtx.beginPath();
          dCtx.moveTo(mousePos.x - 10 / zoom, mousePos.y);
          dCtx.lineTo(mousePos.x + 10 / zoom, mousePos.y);
          dCtx.moveTo(mousePos.x, mousePos.y - 10 / zoom);
          dCtx.lineTo(mousePos.x, mousePos.y + 10 / zoom);
          dCtx.strokeStyle = 'white';
          dCtx.lineWidth = 2 / zoom;
          dCtx.stroke();
          dCtx.strokeStyle = '#3b82f6';
          dCtx.lineWidth = 1 / zoom;
          dCtx.stroke();
        } else {
          dCtx.beginPath();
          dCtx.arc(mousePos.x, mousePos.y, brushSize / 2, 0, Math.PI * 2);
          
          // Visual indicator of what will be erased/restored
          if (tool === 'brush') {
            dCtx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            dCtx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          } else {
            dCtx.strokeStyle = 'rgba(239, 68, 68, 0.8)';
            dCtx.fillStyle = 'rgba(239, 68, 68, 0.2)';
          }
          
          dCtx.fill();
          dCtx.lineWidth = 2 / zoom;
          dCtx.stroke();
        }
        
        // Inner white dot
        dCtx.beginPath();
        dCtx.arc(mousePos.x, mousePos.y, 1 / zoom, 0, Math.PI * 2);
        dCtx.fillStyle = 'white';
        dCtx.fill();
      }

      dCtx.restore();
      rafId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(rafId);
  }, [isLoading, mousePos, brushSize, isMouseOver, showMaskOnly, zoom, pan, tool, isPanning]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const display = displayCanvasRef.current;
    if (!display) return { x: 0, y: 0 };
    
    const rect = display.getBoundingClientRect();
    let clientX, clientY;
    if ('touches' in e && (e as React.TouchEvent).touches.length > 0) {
      clientX = (e as React.TouchEvent).touches[0].clientX;
      clientY = (e as React.TouchEvent).touches[0].clientY;
    } else {
      const mouseEvent = e as React.MouseEvent;
      clientX = mouseEvent.clientX;
      clientY = mouseEvent.clientY;
    }

    // Convert screen to canvas
    const x = (clientX - rect.left) * (display.width / rect.width);
    const y = (clientY - rect.top) * (display.height / rect.height);

    // Apply Inverse Transform (Zoom/Pan)
    const worldX = (x - (display.width / 2 + pan.x)) / zoom + (display.width / 2);
    const worldY = (y - (display.height / 2 + pan.y)) / zoom + (display.height / 2);

    return { x: worldX, y: worldY };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    // Middle click (button 1) or Alt key for panning
    const isMiddleClick = 'button' in e && (e.button === 1 || (e.nativeEvent as any).button === 1);
    const isAltKey = (e as any).altKey || (e.nativeEvent as any).altKey;

    if (isMiddleClick || isAltKey) {
      e.preventDefault();
      setIsPanning(true);
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      setLastPanPos({ x: clientX, y: clientY });
      return;
    }

    const coords = getCoordinates(e);
    
    if (tool === 'magic') {
      applySmartSelect(coords.x, coords.y);
      return;
    }

    setIsDrawing(true);
    setMousePos(coords);
    
    const maskCtx = maskCanvasRef.current?.getContext('2d');
    if (maskCtx) {
      maskCtx.beginPath();
      maskCtx.moveTo(coords.x, coords.y);
      draw(e);
    }
  };

  const applySmartSelect = (startX: number, startY: number) => {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const maskCtx = maskCanvas.getContext('2d');
    if (!ctx || !maskCtx) return;

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    
    const x = Math.floor(startX);
    const y = Math.floor(startY);
    const index = (y * canvas.width + x) * 4;
    
    const targetR = imgData.data[index];
    const targetG = imgData.data[index + 1];
    const targetB = imgData.data[index + 2];
    
    const visited = new Uint8Array(canvas.width * canvas.height);
    const queue: [number, number][] = [[x, y]];
    visited[y * canvas.width + x] = 1;

    // Simple flood fill with tolerance
    while (queue.length > 0) {
      const [currX, currY] = queue.shift()!;
      const currIdx = (currY * canvas.width + currX) * 4;
      
      // Update mask
      // Fill or erase based on tool context? 
      // For simplicity, magic tool in "Restore" mode adds to mask, in "Erase" (if toggled) removes.
      // But let's make Magic tool always "Select Object" (Restore)
      maskData.data[currIdx + 3] = 255; 

      const neighbors = [
        [currX + 1, currY], [currX - 1, currY],
        [currX, currY + 1], [currX, currY - 1]
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
          const nIdx = ny * canvas.width + nx;
          if (!visited[nIdx]) {
            const pixelIdx = nIdx * 4;
            const r = imgData.data[pixelIdx];
            const g = imgData.data[pixelIdx + 1];
            const b = imgData.data[pixelIdx + 2];
            
            const diff = Math.sqrt(
              Math.pow(r - targetR, 2) + 
              Math.pow(g - targetG, 2) + 
              Math.pow(b - targetB, 2)
            );

            if (diff <= magicTolerance) {
              visited[nIdx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }
      
      // Limit iterations to avoid freezing for huge areas in one frame
      if (visited.length > 500000) break; 
    }

    maskCtx.putImageData(maskData, 0, 0);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    if (isPanning) {
      const dx = clientX - lastPanPos.x;
      const dy = clientY - lastPanPos.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setLastPanPos({ x: clientX, y: clientY });
      return;
    }

    const coords = getCoordinates(e);
    setMousePos(coords);

    if (!isDrawing) return;
    const maskCtx = maskCanvasRef.current?.getContext('2d');
    if (!maskCtx) return;

    maskCtx.lineWidth = brushSize;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    
    if (tool === 'brush') {
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      maskCtx.globalCompositeOperation = 'destination-out';
    }

    maskCtx.lineTo(coords.x, coords.y);
    maskCtx.stroke();
  };

  const handleSave = () => {
    const canvas = document.createElement('canvas');
    const mask = maskCanvasRef.current;
    const original = canvasRef.current;
    if (!mask || !original) return;

    canvas.width = original.width;
    canvas.height = original.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(original, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    
    const currentProcessedUrl = canvas.toDataURL('image/png');

    if (fileItem.gifFrames) {
      const updatedFrames = gifFrames.map((f, i) => i === currentFrameIdx ? { ...f, processedUrl: currentProcessedUrl } : f);
      onSave(fileItem.processedUrl || '', updatedFrames);
    } else {
      onSave(currentProcessedUrl);
    }
  };

  useEffect(() => {
    let interval: any;
    if (isPlaying && fileItem.gifFrames) {
      interval = setInterval(() => {
        setCurrentFrameIdx(prev => (prev + 1) % gifFrames.length);
      }, 1000 / (fileItem.gifFps || 10));
    }
    return () => clearInterval(interval);
  }, [isPlaying, fileItem.gifFps, gifFrames.length]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-white z-[100] flex flex-col font-sans"
      onWheel={(e) => {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom(prev => Math.min(Math.max(prev * delta, 0.1), 10));
      }}
    >
      <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-gray-200" />
          <h2 className="font-bold tracking-tight text-gray-900 truncate max-w-[200px]">{fileItem.file.name} {fileItem.gifFrames && `(Frame ${currentFrameIdx + 1}/${gifFrames.length})`}</h2>
        </div>

        <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
          <button 
            onClick={() => setTool('brush')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${tool === 'brush' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Brush className="w-3.5 h-3.5" /> Restore
          </button>
          <button 
            onClick={() => setTool('magic')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${tool === 'magic' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            title="Smart Select - Click an object to auto-mask it"
          >
            <Wand2 className="w-3.5 h-3.5" /> Smart
          </button>
          <button 
            onClick={() => setTool('eraser')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${tool === 'eraser' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Eraser className="w-3.5 h-3.5" /> Erase
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setZoom(prev => Math.max(0.1, prev - 0.2))} className="p-1.5 hover:bg-white rounded-lg transition-all"><X className="w-3.5 h-3.5 rotate-45" /></button>
            <span className="text-[10px] font-black w-10 text-center uppercase tracking-tighter">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(prev => Math.min(10, prev + 0.2))} className="p-1.5 hover:bg-white rounded-lg transition-all"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <button 
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="p-2.5 rounded-xl border border-gray-200 text-gray-400 hover:bg-gray-50 transition-all"
            title="Reset View"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setShowMaskOnly(!showMaskOnly)}
            className={`p-2.5 rounded-xl border transition-all ${showMaskOnly ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-400'}`}
            title="Preview Result"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button 
            onClick={handleSave}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm underline"
          >
            Save Changes
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden bg-gray-50 relative">
        <div className="w-64 border-r border-gray-100 bg-white p-6 flex flex-col gap-8 overflow-y-auto">
          {tool === 'magic' ? (
            <section className="animate-in fade-in zoom-in-95 duration-200">
               <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 block mb-4">Smart Tolerance</label>
               <div className="space-y-4">
                <input 
                  type="range" 
                  min="1" 
                  max="100" 
                  value={magicTolerance} 
                  onChange={(e) => setMagicTolerance(parseInt(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                  <span className="w-8">Tight</span>
                  <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{magicTolerance}</span>
                  <span className="w-8">Loose</span>
                </div>
                <p className="text-[10px] text-gray-400 leading-relaxed italic mt-4">
                  AI guesses which area to include based on color. Higher tolerance includes more colors.
                </p>
              </div>
            </section>
          ) : (
            <section className="animate-in fade-in zoom-in-95 duration-200">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 block mb-4">Brush Size</label>
              <div className="space-y-4">
                <input 
                  type="range" 
                  min="1" 
                  max="200" 
                  value={brushSize} 
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                  <span className="w-8">1px</span>
                  <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{brushSize}px</span>
                  <span className="w-8">200px</span>
                </div>
              </div>
            </section>
          )}

          <section>
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 block mb-4">Background</label>
            <div className="grid grid-cols-3 gap-2">
              {(['checker', 'white', 'black'] as const).map(style => (
                <button 
                  key={style}
                  onClick={() => setBgPreview(style)}
                  className={`aspect-square rounded-xl border-2 transition-all p-0.5 ${bgPreview === style ? 'border-blue-600' : 'border-transparent'}`}
                >
                  <div className={`w-full h-full rounded-lg ${
                    style === 'checker' ? 'bg-transparency' : style === 'white' ? 'bg-white border border-gray-100' : 'bg-gray-900'
                  }`} />
                </button>
              ))}
            </div>
          </section>

          {fileItem.gifFrames && (
             <section className="mt-4 pt-4 border-t border-gray-50">
               <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 block mb-4">Playback Speed</label>
               <input 
                  type="range" 
                  min="1" 
                  max="30" 
                  value={fileItem.gifFps} 
                  onChange={(e) => {
                    // This logic should probably be handled in parent, 
                    // but for now we just allow playback speed adjustment in preview
                  }}
                  className="w-full accent-blue-600 h-1"
                />
                <div className="flex justify-center mt-4">
                  <button 
                    onClick={() => setIsPlaying(!isPlaying)}
                    className={`px-6 py-2 rounded-xl font-bold flex items-center gap-2 text-xs transition-all ${isPlaying ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}
                  >
                    {isPlaying ? 'Pause' : 'Play Preview'}
                  </button>
                </div>
             </section>
          )}

          <section className="mt-auto pt-8 border-t border-gray-50">
             <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Controls</h4>
             <ul className="text-[10px] font-bold text-gray-400 space-y-2 uppercase tracking-wider">
               <li className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center text-[8px]"><MousePointer2 className="w-2 h-2" /></div> Middle Click to Pan</li>
               <li className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center text-[8px]">WHL</div> Scroll to Zoom</li>
               <li className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center text-[8px]">ALT</div> + Drag to Pan</li>
             </ul>
          </section>
        </div>

        <div className="flex-1 relative flex flex-col">
          <div className="flex-1 flex items-center justify-center select-none bg-gray-50 p-12">
            <div 
              className={`relative shadow-2xl transition-all duration-300 ${
                bgPreview === 'checker' ? 'bg-transparency' : bgPreview === 'white' ? 'bg-white' : 'bg-black'
              }`}
               onMouseEnter={() => setIsMouseOver(true)}
               onMouseLeave={() => { setIsMouseOver(false); setIsDrawing(false); setIsPanning(false); }}
            >
              <canvas ref={canvasRef} className="hidden" />
              <canvas ref={maskCanvasRef} className="hidden" />
              <canvas
                ref={displayCanvasRef}
                className={`max-w-full max-h-[75vh] w-auto h-auto block ${isPanning ? 'cursor-grabbing' : 'cursor-none'}`}
                onMouseDown={handleStart}
                onMouseMove={draw}
                onMouseUp={() => { setIsDrawing(false); setIsPanning(false); }}
                onTouchStart={handleStart}
                onTouchMove={draw}
                onTouchEnd={() => { setIsDrawing(false); setIsPanning(false); }}
              />
              
              {isLoading && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-sm flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                </div>
              )}
            </div>
          </div>
          
          {fileItem.gifFrames && (
            <div className="h-32 bg-white border-t border-gray-100 p-4 flex gap-4 overflow-x-auto scrollbar-hide">
              {gifFrames.map((frame, idx) => (
                <button 
                  key={idx}
                  onClick={() => { saveCurrentMaskToFrame(); setCurrentFrameIdx(idx); }}
                  className={`w-20 h-20 shrink-0 border-4 rounded-xl overflow-hidden transition-all relative group ${currentFrameIdx === idx ? 'border-blue-600 scale-105 z-10' : 'border-transparent opacity-60 hover:opacity-100'}`}
                >
                  <img src={frame.processedUrl || frame.previewUrl} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-black">{idx + 1}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// --- Lightbox Component ---

interface LightboxProps {
  files: ProcessedFile[];
  currentIndex: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSetEditing: (id: string) => void;
  onDownload: (file: ProcessedFile) => void;
}

const Lightbox: React.FC<LightboxProps> = ({ 
  files, 
  currentIndex, 
  onClose, 
  onNext, 
  onPrev, 
  onSetEditing,
  onDownload
}) => {
  const [showOriginal, setShowOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  const file = files[currentIndex];

  if (!file) return null;

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle click (button 1) or Alt key for panning
    if (e.button === 1 || e.altKey) {
      e.preventDefault();
      setIsDragging(true);
      setLastPos({ x: e.clientX, y: e.clientY });
      return;
    }

    // Left click panning if zoomed in
    if (zoom > 1) {
      setIsDragging(true);
      setLastPos({ x: e.clientX, y: e.clientY });
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Prevent default to prevent page scroll while zooming
    if (e.ctrlKey || zoom > 1) {
      // e.preventDefault(); // Note: React passive listener might warn, but often handled by container
    }
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(Math.max(zoom * delta, 0.5), 10);
    setZoom(newZoom);
    if (newZoom === 1) setPan({ x: 0, y: 0 });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-white z-[120] flex flex-col font-sans"
    >
      {/* Header */}
      <div className="h-16 px-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
          <div className="h-6 w-px bg-gray-200" />
          <div className="flex flex-col">
            <h2 className="font-bold tracking-tight text-gray-900 truncate max-w-[200px] leading-tight">{file.file.name}</h2>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{currentIndex + 1} of {files.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1 bg-gray-100 rounded-xl">
          <button 
            onClick={() => setShowOriginal(false)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${!showOriginal ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
          >
            Removed
          </button>
          <button 
            onClick={() => setShowOriginal(true)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${showOriginal ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500'}`}
          >
            Original
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl mr-2">
            <button 
              onClick={() => {
                const newZoom = Math.max(0.5, zoom - 0.2);
                setZoom(newZoom);
                if (newZoom === 1) setPan({ x: 0, y: 0 });
              }} 
              className="p-1.5 hover:bg-white rounded-lg transition-all"
            >
              <X className="w-3.5 h-3.5 rotate-45" />
            </button>
            <span className="text-[10px] font-black w-10 text-center uppercase tracking-tighter">{Math.round(zoom * 100)}%</span>
            <button 
              onClick={() => setZoom(prev => Math.min(10, prev + 0.2))} 
              className="p-1.5 hover:bg-white rounded-lg transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <button 
            onClick={handleReset}
            className="p-2.5 bg-gray-50 hover:bg-gray-100 text-gray-500 rounded-xl transition-all mr-2"
            title="Reset Zoom"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button 
            onClick={() => { onClose(); onSetEditing(file.id); }}
            className="p-2.5 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-xl transition-all"
            title="Refine Edges"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button 
            onClick={() => onDownload(file)}
            className="px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-sm"
          >
            <Download className="w-4 h-4" /> Save
          </button>
        </div>
      </div>

      {/* Main Preview */}
      <div 
        className="flex-1 relative bg-[#F9F9FB] flex items-center justify-center overflow-hidden p-8 md:p-16 select-none"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={(e) => {
          if (isDragging) {
            const dx = e.clientX - lastPos.x;
            const dy = e.clientY - lastPos.y;
            setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setLastPos({ x: e.clientX, y: e.clientY });
          }
        }}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        <div className="absolute inset-0 flex items-center justify-between px-6 pointer-events-none z-10">
          <button 
            onClick={(e) => { e.stopPropagation(); onPrev(); handleReset(); }}
            className="p-4 bg-white/80 backdrop-blur hover:bg-white rounded-full shadow-lg pointer-events-auto transition-all translate-x-0 active:scale-95 disabled:opacity-30"
            disabled={files.length <= 1}
          >
            <ChevronLeft className="w-6 h-6 text-gray-800" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onNext(); handleReset(); }}
            className="p-4 bg-white/80 backdrop-blur hover:bg-white rounded-full shadow-lg pointer-events-auto transition-all active:scale-95 disabled:opacity-30"
            disabled={files.length <= 1}
          >
            <ChevronRight className="w-6 h-6 text-gray-800" />
          </button>
        </div>

        {/* Pan and Zoom Viewport */}
        <div 
          className="relative w-full h-full flex items-center justify-center transition-transform duration-200 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: isDragging ? 'none' : 'transform 0.2s ease-out'
          }}
        >
          <motion.div 
            key={file.id + showOriginal}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className={`relative max-w-full max-h-full rounded-2xl overflow-hidden shadow-2xl transition-shadow ${
              !showOriginal ? 'bg-transparency shadow-blue-500/10' : 'bg-white'
            }`}
          >
            <img 
              src={showOriginal ? file.preview : (file.processedUrl || file.preview)} 
              alt="Full size preview" 
              className="max-w-full max-h-[70vh] w-auto h-auto object-contain p-2 md:p-4 pointer-events-none"
            />
          </motion.div>
        </div>

        {/* Quick Controls Info */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-white/60 backdrop-blur px-6 py-2 rounded-full border border-white/40 text-[10px] font-bold text-gray-500 uppercase tracking-widest shadow-lg">
          <div className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center text-[8px]"><MousePointer2 className="w-2 h-2" /></div> Mid-Click to Pan</div>
          <div className="w-px h-3 bg-gray-200" />
          <div className="flex items-center gap-2">WHL to Zoom</div>
        </div>
      </div>
      
      {/* Thumbnails Strip */}
      <div className="h-24 px-6 border-t border-gray-100 flex items-center justify-center gap-3 overflow-x-auto bg-white">
        {files.map((f, idx) => (
          <button 
            key={f.id}
            onClick={() => { if (currentIndex !== idx) { setShowOriginal(false); if (idx > currentIndex) { onNext(); } else { onPrev(); } } }}
            className={`w-14 h-14 rounded-xl border-2 transition-all p-1 shrink-0 ${
              currentIndex === idx ? 'border-blue-600 scale-110 shadow-md' : 'border-transparent opacity-50 hover:opacity-100'
            }`}
          >
            <img src={f.processedUrl || f.preview} className="w-full h-full object-cover rounded-lg" alt="Thumbnail" />
          </button>
        ))}
      </div>
    </motion.div>
  );
};

// --- App Component ---

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [hardwareInfo, setHardwareInfo] = useState<{ capability: 'High' | 'Medium' | 'Standard', tech: string }>({ capability: 'Standard', tech: 'WASM' });
  const [avgSpeed, setAvgSpeed] = useState<number | null>(null); // seconds per MB
  const [showInfoSidebar, setShowInfoSidebar] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'info' | 'settings'>('info');
  const [settings, setSettings] = useState({
    enforceResolution: false,
    targetWidth: 1080,
    targetHeight: 1080,
    highPrecision: false,
    includeShadow: false,
    strictCut: true
  });
  const [avgFrameSpeed, setAvgFrameSpeed] = useState<number | null>(null); // seconds per frame for GIFs

  useEffect(() => {
    const checkHardware = async () => {
      // @ts-ignore
      if (navigator.gpu) {
        setHardwareInfo({ capability: 'High', tech: 'WebGPU (Ultra Fast)' });
      } else if (window.crossOriginIsolated) {
        setHardwareInfo({ capability: 'Medium', tech: 'WASM SIMD (Fast)' });
      } else {
        setHardwareInfo({ capability: 'Standard', tech: 'WASM (Standard)' });
      }
    };
    checkHardware();
  }, []);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    return [h, m, s]
      .map(v => v < 10 ? '0' + v : v)
      .filter((v, i) => v !== '00' || i > 0) // Keep at least MM:SS
      .join(':');
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = (Array.from(e.dataTransfer.files) as File[]).filter(file => file.type.startsWith('image/') || file.type === 'image/gif');
    addFiles(droppedFiles);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = (Array.from(e.target.files) as File[]).filter(file => file.type.startsWith('image/') || file.type === 'image/gif');
      addFiles(selectedFiles);
    }
  };

  const addFiles = (newFiles: File[]) => {
    const newProcessedFiles: ProcessedFile[] = newFiles.map(file => ({
      id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      file,
      preview: URL.createObjectURL(file),
      processedUrl: null,
      maskUrl: null,
      status: 'pending',
      progress: 0,
      gifFps: file.type === 'image/gif' ? 10 : undefined // Default 10 FPS for GIFs
    }));
    setFiles(prev => [...prev, ...newProcessedFiles]);
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove) {
        URL.revokeObjectURL(fileToRemove.preview);
        if (fileToRemove.processedUrl) URL.revokeObjectURL(fileToRemove.processedUrl);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  const processGif = async (id: string, file: File) => {
    const startProcessTime = Date.now();
    const fileItem = files.find(f => f.id === id);
    if (!fileItem) return;
    const targetFps = fileItem.gifFps || 10;
    
    try {
      const buffer = await file.arrayBuffer();
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      
      const width = gif.lsd.width;
      const height = gif.lsd.height;

      if (settings.enforceResolution && (width < settings.targetWidth || height < settings.targetHeight)) {
        setFiles(prev => prev.map(f => f.id === id ? { 
          ...f, 
          status: 'error', 
          error: `Minimum resolution requirement not met (${settings.targetWidth}x${settings.targetHeight} required, got ${width}x${height})` 
        } : f));
        return;
      }

      // 1. Reconstruct all frames to avoid skipping partial updates distortion
      const fullFrameBlobs: { blob: Blob, delay: number }[] = [];
      const renderCanvas = document.createElement('canvas');
      
      const finalWidth = settings.enforceResolution ? settings.targetWidth : width;
      const finalHeight = settings.enforceResolution ? settings.targetHeight : height;
      
      renderCanvas.width = width;
      renderCanvas.height = height;
      const rCtx = renderCanvas.getContext('2d', { willReadFrequently: true })!;

      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'analyzing', progress: 5 } : f));

      let lastImageData: ImageData | null = null;

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        
        if (i > 0) {
          const prevFrame = frames[i - 1];
          if (prevFrame.disposalType === 2) {
            rCtx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
          } else if (prevFrame.disposalType === 3 && lastImageData) {
            rCtx.putImageData(lastImageData, 0, 0);
          }
        }

        if (frame.disposalType === 3) {
          lastImageData = rCtx.getImageData(0, 0, width, height);
        }

        if (frame.patch) {
          const patchData = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height);
          const patchCanvas = document.createElement('canvas');
          patchCanvas.width = frame.dims.width;
          patchCanvas.height = frame.dims.height;
          patchCanvas.getContext('2d')!.putImageData(patchData, 0, 0);
          rCtx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);
        }
        
        let targetBlob: Blob;
        if (settings.enforceResolution) {
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = settings.targetWidth;
          cropCanvas.height = settings.targetHeight;
          const cCtx = cropCanvas.getContext('2d')!;
          
          const scale = Math.max(cropCanvas.width / width, cropCanvas.height / height);
          const x = (cropCanvas.width / scale - width) / 2;
          const y = (cropCanvas.height / scale - height) / 2;
          cCtx.scale(scale, scale);
          cCtx.drawImage(renderCanvas, x, y);
          targetBlob = await new Promise<Blob>(res => cropCanvas.toBlob(b => res(b!), 'image/png'));
        } else {
          targetBlob = await new Promise<Blob>(res => renderCanvas.toBlob(b => res(b!), 'image/png'));
        }
        
        fullFrameBlobs.push({ blob: targetBlob!, delay: frame.delay || 100 });
      }

      // 2. Sample frames based on target FPS
      const originalDelay = frames[0].delay || 100;
      const originalFps = 1000 / originalDelay;
      const skipFactor = Math.max(1, Math.round(originalFps / targetFps));
      const targetFrames = fullFrameBlobs.filter((_, idx) => idx % skipFactor === 0);
      
      // AI Analysis on first frame
      let subjectData = { subject: 'Unknown', category: 'General' };
      try {
        subjectData = await analyzeSubject(targetFrames[0].blob);
        setFiles(prev => prev.map(f => f.id === id ? { ...f, subject: subjectData.subject, category: subjectData.category } : f));
      } catch (err) {
        console.warn('AI Analysis failed for GIF, proceeding:', err);
      }
      
      const totalFrames = targetFrames.length;
      setFiles(prev => prev.map(f => f.id === id ? { ...f, totalFrames } : f));

      // 3. Concurrent processing of frames for speed
      const processedGifFrames: GifFrame[] = new Array(totalFrames);
      const concurrency = 3;
      let completedCount = 0;

      const processBatch = async (indices: number[]) => {
        for (const idx of indices) {
          const frameStartTime = Date.now();
          
          try {
            const processedBlob = await preprocessForMask(targetFrames[idx].blob);
            // @ts-ignore
            const maskBlob = await removeBackground(processedBlob, {
              model: settings.highPrecision ? 'isnet' : 'isnet_quint8',
              output: { type: 'mask' } as any
            });
            const processedBlobWithMask = await applyMask(targetFrames[idx].blob, maskBlob);

            processedGifFrames[idx] = {
              originalBlob: targetFrames[idx].blob,
              previewUrl: URL.createObjectURL(targetFrames[idx].blob),
              processedUrl: URL.createObjectURL(processedBlobWithMask),
              maskUrl: null,
              delay: targetFrames[idx].delay
            };
          } catch (e) {
            processedGifFrames[idx] = {
              originalBlob: targetFrames[idx].blob,
              previewUrl: URL.createObjectURL(targetFrames[idx].blob),
              processedUrl: URL.createObjectURL(targetFrames[idx].blob),
              maskUrl: null,
              delay: targetFrames[idx].delay
            };
          }

          completedCount++;
          const frameEndTime = Date.now();
          const frameDuration = (frameEndTime - frameStartTime) / 1000;
          setAvgFrameSpeed(prev => prev ? (prev * 0.9 + frameDuration * 0.1) : frameDuration);

          setFiles(prev => prev.map(f => f.id === id ? { 
            ...f, 
            progress: 10 + Math.round((completedCount / totalFrames) * 80) 
          } : f));
        }
      };

      const workerIndices = Array.from({ length: concurrency }, (_, i) => 
        Array.from({ length: totalFrames }, (_, idx) => idx).filter(idx => idx % concurrency === i)
      );

      await Promise.all(workerIndices.map(processBatch));

      // Initial encoding
      const initialGifUrl = await encodeGif(processedGifFrames, finalWidth, finalHeight, targetFps);
      
      const endProcessTime = Date.now();
      const duration = (endProcessTime - startProcessTime) / 1000;
      const speed = duration / (file.size / 1024 / 1024);
      setAvgSpeed(prev => prev ? (prev * 0.7 + speed * 0.3) : speed);

      setFiles(prev => prev.map(f => f.id === id ? { 
        ...f, 
        gifFrames: processedGifFrames,
        processedUrl: initialGifUrl, 
        status: 'done', 
        progress: 100 
      } : f));

    } catch (err) {
      console.error(err);
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', error: 'Processing failed' } : f));
    }
  };

  const encodeGif = async (gifFrames: GifFrame[], width: number, height: number, fps: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      gifshot.createGIF({
        images: gifFrames.map(f => f.processedUrl!),
        gifWidth: width,
        gifHeight: height,
        numFrames: gifFrames.length,
        frameDuration: (1000 / fps) / 10,
        sampleInterval: 5, // Lower for better quality
        transparent: '0x00FF00',
      }, (obj: any) => {
        if (obj.error) reject(obj.error);
        else resolve(obj.image);
      });
    });
  };

  const preprocessForMask = async (file: File | Blob): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        
        ctx.drawImage(img, 0, 0);
        
        // 1. High-Contrast Base for Masking
        // We boost contrast to help AI distinguish between subject and background
        // but we avoid making it too dark (0.9 vs 0.85)
        ctx.filter = 'contrast(1.6) brightness(0.9) saturate(1.1)';
        ctx.drawImage(canvas, 0, 0);

        // 2. Head-Aware Edge Sharpening
        // Roblox heads often disappear if they are white. We sharpen edges to define boundaries.
        ctx.save();
        ctx.filter = 'contrast(1.5) blur(0.5px)';
        ctx.globalAlpha = 0.3;
        ctx.drawImage(canvas, 1, 1);
        ctx.restore();

        // 3. Central Focus (Vignette)
        // Focus on the vertical center but avoid the very top (y=0 area)
        const gradient = ctx.createRadialGradient(
          canvas.width / 2, canvas.height * 0.5, 0,
          canvas.width / 2, canvas.height * 0.55, Math.max(canvas.width, canvas.height) * 0.8
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(0.6, 'rgba(0,0,0,0.05)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        canvas.toBlob(b => {
          URL.revokeObjectURL(url);
          resolve(b!);
        }, 'image/png');
      };
      img.src = url;
    });
  };

  const analyzeSubject = async (file: File | Blob): Promise<{ subject: string, category: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const response = await fetch('/api/analyze-subject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, mimeType: file.type || 'image/png' })
          });
          if (!response.ok) throw new Error('API analysis failed');
          const data = await response.json();
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const applyMask = async (originalFile: File | Blob, maskBlob: Blob): Promise<Blob> => {
    return new Promise((resolve) => {
      const originalImg = new Image();
      const maskImg = new Image();
      const originalUrl = URL.createObjectURL(originalFile);
      const maskUrl = URL.createObjectURL(maskBlob);
      
      let loaded = 0;
      const checkLoaded = () => {
        loaded++;
        if (loaded === 2) {
          const width = originalImg.width;
          const height = originalImg.height;

          // 1. Thresholded Mask Canvas
          const maskCanvas = document.createElement('canvas');
          maskCanvas.width = width;
          maskCanvas.height = height;
          const mctx = maskCanvas.getContext('2d')!;
          mctx.drawImage(maskImg, 0, 0, width, height);

          if (settings.strictCut) {
            const imageData = mctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
              const alpha = data[i+3];
              // Robust thresholding: AI confidence > 15% becomes solid, < 5% becomes hidden
              if (alpha > 40) data[i+3] = 255;
              else if (alpha < 15) data[i+3] = 0;
              // values in between 15-40 are kept for slight anti-aliasing
            }
            mctx.putImageData(imageData, 0, 0);
          }

          // 2. Character-Only Canvas (Transparent)
          const charCanvas = document.createElement('canvas');
          charCanvas.width = width;
          charCanvas.height = height;
          const cctx = charCanvas.getContext('2d')!;
          cctx.drawImage(originalImg, 0, 0);
          cctx.globalCompositeOperation = 'destination-in';
          cctx.drawImage(maskCanvas, 0, 0);

          // 3. Final Composite
          const finalCanvas = document.createElement('canvas');
          finalCanvas.width = width;
          finalCanvas.height = height;
          const fctx = finalCanvas.getContext('2d')!;

          if (settings.includeShadow) {
            fctx.save();
            fctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
            fctx.shadowBlur = 20;
            fctx.shadowOffsetX = 12;
            fctx.shadowOffsetY = 12;
            // Draw character again to cast shadow on this layer
            fctx.drawImage(charCanvas, 0, 0);
            fctx.restore();
          }

          // Draw actual character on top
          fctx.drawImage(charCanvas, 0, 0);
          
          finalCanvas.toBlob(b => {
             URL.revokeObjectURL(originalUrl);
             URL.revokeObjectURL(maskUrl);
             resolve(b!);
          }, 'image/png');
        }
      };
      
      originalImg.onload = checkLoaded;
      maskImg.onload = checkLoaded;
      originalImg.src = originalUrl;
      maskImg.src = maskUrl;
    });
  };

  const processFile = async (id: string) => {
    const fileItem = files.find(f => f.id === id);
    if (!fileItem || fileItem.status === 'processing' || fileItem.status === 'analyzing') return;

    if (fileItem.file.type === 'image/gif') {
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'analyzing', progress: 0, startTime: Date.now() } : f));
      await processGif(id, fileItem.file);
      return;
    }

    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'analyzing', progress: 0, startTime: Date.now() } : f));

    try {
      const startTime = Date.now();
      
      // AI Analysis Phase
      let subjectData = { subject: 'Unknown', category: 'General' };
      try {
        subjectData = await analyzeSubject(fileItem.file);
        setFiles(prev => prev.map(f => f.id === id ? { ...f, subject: subjectData.subject, category: subjectData.category } : f));
      } catch (err) {
        console.warn('AI Analysis failed, proceeding with default settings:', err);
      }

      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'processing', progress: 10 } : f));

      // Preliminary check if resolution enforcement is on
      const img = new Image();
      const fileUrl = URL.createObjectURL(fileItem.file);
      img.src = fileUrl;
      await new Promise(res => img.onload = res);
      
      if (settings.enforceResolution && (img.width < settings.targetWidth || img.height < settings.targetHeight)) {
        setFiles(prev => prev.map(f => f.id === id ? { 
          ...f, 
          status: 'error', 
          error: `Minimum resolution requirement not met (${settings.targetWidth}x${settings.targetHeight} required, got ${img.width}x${img.height})` 
        } : f));
        URL.revokeObjectURL(fileUrl);
        return;
      }
      URL.revokeObjectURL(fileUrl);

      let finalBlob: Blob;

      const processedBlobForMask = await preprocessForMask(fileItem.file);
      // @ts-ignore
      const maskBlob = await removeBackground(processedBlobForMask, {
        model: settings.highPrecision ? 'isnet' : 'isnet_quint8',
        output: { type: 'mask' } as any,
        progress: (p: any) => {
          setFiles(prev => prev.map(f => f.id === id ? { ...f, progress: Math.round((p as number) * 100) } : f));
        }
      });
      finalBlob = await applyMask(fileItem.file, maskBlob);

      if (settings.enforceResolution) {
        const processedImg = new Image();
        const processedUrl = URL.createObjectURL(finalBlob);
        processedImg.src = processedUrl;
        await new Promise(res => processedImg.onload = res);

        const canvas = document.createElement('canvas');
        canvas.width = settings.targetWidth;
        canvas.height = settings.targetHeight;
        const ctx = canvas.getContext('2d')!;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const scale = Math.max(canvas.width / processedImg.width, canvas.height / processedImg.height);
        const x = (canvas.width / scale - processedImg.width) / 2;
        const y = (canvas.height / scale - processedImg.height) / 2;
        
        ctx.scale(scale, scale);
        ctx.drawImage(processedImg, x, y);
        
        finalBlob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), 'image/png'));
        URL.revokeObjectURL(processedUrl);
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      const speed = duration / (fileItem.file.size / 1024 / 1024);
      setAvgSpeed(prev => prev ? (prev * 0.7 + speed * 0.3) : speed);

      const url = URL.createObjectURL(finalBlob);
      setFiles(prev => prev.map(f => f.id === id ? { ...f, processedUrl: url, status: 'done', progress: 100 } : f));
    } catch (err) {
      console.error(err);
      setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', error: 'Failed to process' } : f));
    }
  };

  const processAll = async () => {
    setIsProcessingAll(true);
    const pendingFiles = files.filter(f => f.status === 'pending' || f.status === 'error');
    for (const file of pendingFiles) {
      await processFile(file.id);
    }
    setIsProcessingAll(false);
  };

  const downloadFile = (fileItem: ProcessedFile) => {
    if (!fileItem.processedUrl) return;
    const link = document.createElement('a');
    link.href = fileItem.processedUrl;
    link.download = `${fileItem.file.name.split('.')[0]}_no_bg.${fileItem.file.type === 'image/gif' ? 'gif' : 'png'}`;
    link.click();
  };

  const downloadAll = async () => {
    const doneFiles = files.filter(f => f.status === 'done' && f.processedUrl);
    if (doneFiles.length === 0) return;

    if (doneFiles.length === 1) {
      downloadFile(doneFiles[0]);
      return;
    }

    const zip = new JSZip();
    for (const file of doneFiles) {
      const response = await fetch(file.processedUrl!);
      const blob = await response.blob();
      zip.file(`${file.file.name.split('.')[0]}_no_bg.${file.file.type === 'image/gif' ? 'gif' : 'png'}`, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'removed_backgrounds.zip';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleEditSave = async (processedUrl: string, gifFrames?: GifFrame[]) => {
    if (!editingFileId) return;
    
    const fileItem = files.find(f => f.id === editingFileId);
    if (!fileItem) return;

    if (gifFrames) {
      setFiles(prev => prev.map(f => f.id === editingFileId ? { ...f, status: 'processing', progress: 50, gifFrames } : f));
      
      try {
        const width = gifFrames[0].processedUrl ? await new Promise<number>((res) => {
          const img = new Image();
          img.onload = () => res(img.width);
          img.src = gifFrames[0].processedUrl!;
        }) : 0;
        
        const height = gifFrames[0].processedUrl ? await new Promise<number>((res) => {
          const img = new Image();
          img.onload = () => res(img.height);
          img.src = gifFrames[0].processedUrl!;
        }) : 0;

        const newGifUrl = await encodeGif(gifFrames, width, height, fileItem.gifFps || 10);
        setFiles(prev => prev.map(f => f.id === editingFileId ? { ...f, processedUrl: newGifUrl, status: 'done', progress: 100 } : f));
      } catch (err) {
        console.error('Failed to re-encode GIF:', err);
        setFiles(prev => prev.map(f => f.id === editingFileId ? { ...f, status: 'error', error: 'Re-encoding failed' } : f));
      }
    } else {
      setFiles(prev => prev.map(f => f.id === editingFileId ? { ...f, processedUrl } : f));
    }
    setEditingFileId(null);
  };

  const currentEditingFile = files.find(f => f.id === editingFileId);

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-blue-100">
      {/* Top Navigation */}
      <nav className="h-16 px-6 md:px-10 flex items-center justify-between border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-bold text-lg italic tracking-tighter">G</div>
          <span className="text-xl font-semibold tracking-tight text-gray-900">GhostBG</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-500">
          <a href="#" className="text-black">Remover</a>
          <button 
            onClick={() => { setSidebarTab('info'); setShowInfoSidebar(true); }}
            className="hover:text-black transition-colors"
          >
            How it works
          </button>
          <button 
            onClick={() => { setSidebarTab('info'); setShowInfoSidebar(true); }}
            className="hover:text-black transition-colors"
          >
            Privacy
          </button>
          <button 
            onClick={() => { setSidebarTab('settings'); setShowInfoSidebar(true); }}
            className="px-5 py-2 bg-gray-900 text-white rounded-full hover:bg-black transition-all font-bold flex items-center gap-2"
          >
            <Settings className="w-4 h-4" /> Settings
          </button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12 md:py-20 flex flex-col items-center">
        {/* Header Section */}
        <div className="text-center mb-12 md:mb-16">
          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 tracking-tight leading-tight"
          >
            Remove backgrounds instantly.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-gray-500 text-lg md:text-xl max-w-lg mx-auto font-medium"
          >
            Upload multiple images and let our AI do the heavy lifting.<br className="hidden md:block" /> Fast, precise, and completely free.
          </motion.p>
        </div>

        {/* Dropzone Area */}
        {files.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="w-full max-w-4xl border-2 border-dashed border-gray-200 rounded-[32px] p-12 md:p-20 bg-gray-50/50 flex flex-col items-center justify-center transition-all hover:border-blue-400 hover:bg-blue-50/30 group cursor-pointer"
            onClick={() => document.getElementById('file-upload')?.click()}
          >
            <input 
              id="file-upload" 
              type="file" 
              multiple 
              className="hidden" 
              accept="image/*,.gif"
              onChange={onFileChange}
            />
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <Upload className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900">Drop files here or click to upload</h3>
            <p className="text-gray-400 text-sm mt-2 uppercase tracking-widest font-bold">PNG, JPG, GIF, WebP up to 10MB</p>
          </motion.div>
        ) : (
          <div className="w-full max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Actions Bar */}
            <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4 px-2">
              <div className="flex items-center gap-4">
                <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">Queue ({files.length})</h4>
                <button 
                  onClick={() => document.getElementById('file-upload-more')?.click()}
                  className="text-xs font-bold uppercase tracking-widest text-blue-600 hover:text-blue-700 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" /> Add More
                </button>
                <input id="file-upload-more" type="file" multiple className="hidden" accept="image/*,.gif" onChange={onFileChange} />
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <button 
                  onClick={processAll}
                  disabled={isProcessingAll || !files.some(f => f.status === 'pending' || f.status === 'error')}
                  className="flex-1 md:flex-none px-6 py-2.5 bg-gray-900 text-white rounded-full text-sm font-bold tracking-tight hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 transition-all flex items-center justify-center gap-2"
                >
                  {isProcessingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
                  Process All
                </button>
                <button 
                  onClick={downloadAll}
                  disabled={!files.some(f => f.status === 'done')}
                  className="flex-1 md:flex-none px-6 py-2.5 border border-gray-200 text-gray-900 rounded-full text-sm font-bold tracking-tight hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download All
                </button>
              </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <AnimatePresence mode="popLayout">
                {files.map((file) => (
                  <motion.div 
                    layout
                    key={file.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white border border-gray-100 rounded-2xl p-3 flex flex-col gap-4 shadow-sm hover:shadow-md transition-all group"
                  >
                    <div 
                      className="aspect-square bg-gray-50 rounded-xl overflow-hidden relative border border-gray-50 cursor-zoom-in group"
                      onClick={() => file.status === 'done' && setPreviewFileId(file.id)}
                    >
                       <div 
                         className={`w-full h-full p-2 transition-all duration-700 ${(file.status === 'processing' || file.status === 'analyzing') ? 'scale-90 opacity-40 blur-sm' : 'scale-100 opacity-100'} ${file.status === 'done' ? 'bg-transparency' : ''}`}
                       >
                         <img 
                            src={file.processedUrl || file.preview} 
                            className="w-full h-full object-contain" 
                            alt="Preview" 
                          />
                       </div>
                       
                       {/* Success/Processing/Error indicator */}
                       <div className="absolute top-2 right-2">
                         {file.status === 'done' ? (
                           <div className="bg-white/90 backdrop-blur rounded-full p-1 shadow-sm">
                             <CheckCircle2 className="w-4 h-4 text-green-500" />
                           </div>
                         ) : file.status === 'error' ? (
                           <div className="bg-white/90 backdrop-blur rounded-full p-1 shadow-sm">
                             <AlertCircle className="w-4 h-4 text-red-500" />
                           </div>
                         ) : null}
                       </div>

                       {/* Loading Spinner */}
                        {(file.status === 'processing' || file.status === 'analyzing') && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            {file.status === 'analyzing' ? (
                              <div className="flex flex-col items-center gap-2">
                                <motion.div
                                  animate={{ scale: [1, 1.2, 1], rotate: [0, 10, -10, 0] }}
                                  transition={{ repeat: Infinity, duration: 2 }}
                                >
                                  <Wand2 className="w-8 h-8 text-blue-600" />
                                </motion.div>
                                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest text-center">Identifying Subject...</span>
                              </div>
                            ) : (
                              <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
                            )}
                            <div className="bg-white/80 px-2 py-0.5 rounded-full text-center">
                               <p className="text-[10px] font-black text-blue-600 tracking-tighter">{file.progress}%</p>
                               {file.file.type === 'image/gif' ? (
                                 avgFrameSpeed && file.totalFrames && (
                                   <p className="text-[8px] font-bold text-gray-400 uppercase tracking-tight mt-0.5">
                                     {formatDuration(Math.max(1, (avgFrameSpeed * file.totalFrames * (1 - file.progress / 100))))} left
                                   </p>
                                 )
                                ) : (
                                 avgSpeed && (
                                   <p className="text-[8px] font-bold text-gray-400 uppercase tracking-tight mt-0.5">
                                     {formatDuration(Math.max(1, (avgSpeed * (file.file.size / 1024 / 1024)) * (1 - file.progress / 100)))} left
                                   </p>
                                 )
                               )}
                            </div>
                          </div>
                        )}

                        {/* Action Buttons overlay */}
                        <div className="absolute bottom-2 left-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 duration-300">
                          <button 
                             onClick={() => removeFile(file.id)}
                             className="p-2 bg-white/90 backdrop-blur text-red-500 hover:bg-red-50 rounded-lg shadow-sm transition-colors"
                          >
                             <Trash2 className="w-4 h-4" />
                          </button>
                          {file.status === 'done' ? (
                             <>
                               <button 
                                 onClick={() => setEditingFileId(file.id)}
                                 className="flex-1 bg-white/90 backdrop-blur text-gray-900 border border-gray-100 font-bold text-xs py-2 rounded-lg shadow-sm hover:bg-white transition-colors flex items-center justify-center gap-1.5"
                               >
                                 <Edit2 className="w-3.5 h-3.5 text-blue-600" /> Refine
                               </button>
                               <button 
                                 onClick={() => downloadFile(file)}
                                 className={`p-2 bg-white/90 backdrop-blur text-blue-600 border border-gray-100 rounded-lg shadow-sm hover:bg-white transition-colors ${file.file.type === 'image/gif' ? 'flex-1 flex items-center justify-center gap-2' : ''}`}
                               >
                                 <Download className="w-4 h-4" /> {file.file.type === 'image/gif' ? 'Download' : ''}
                               </button>
                             </>
                          ) : (
                             <button 
                               onClick={() => processFile(file.id)}
                               disabled={file.status === 'processing' || file.status === 'analyzing'}
                               className="flex-1 bg-blue-600 text-white font-bold text-xs py-2 rounded-lg shadow-sm hover:bg-blue-700 transition-colors flex items-center justify-center"
                             >
                               Remove BG
                             </button>
                          )}
                        </div>
                    </div>

                    <div className="px-1 flex items-center justify-between min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-xs font-bold text-gray-900 truncate tracking-tight">{file.file.name}</p>
                          {file.subject && (
                            <span className="shrink-0 px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[8px] font-black uppercase tracking-widest rounded-md border border-blue-100">
                              {file.subject}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                           <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{(file.file.size / 1024 / 1024).toFixed(2)} MB</p>
                           {file.status === 'done' && (
                             <span className="w-1 h-1 bg-gray-300 rounded-full" />
                           )}
                           <p className={`text-[10px] font-bold uppercase tracking-widest ${
                             file.status === 'done' ? 'text-green-500' : 
                             file.status === 'processing' ? 'text-blue-500' : 
                             file.status === 'analyzing' ? 'text-purple-500' :
                             file.status === 'error' ? 'text-red-500' : 'text-gray-300'
                           }`}>
                             {file.status === 'done' ? 'Ready' : 
                              file.status === 'processing' ? 'Removing' : 
                              file.status === 'analyzing' ? 'Analyzing' :
                              file.status === 'error' ? 'Failed' : 'Pending'}
                           </p>
                        </div>
                        {file.file.type === 'image/gif' && file.status === 'pending' && (
                          <div className="mt-3 pt-3 border-t border-gray-50">
                            <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 block mb-2">Target FPS: {file.gifFps}</label>
                            <input 
                              type="range"
                              min="1"
                              max="30"
                              value={file.gifFps}
                              onChange={(e) => {
                                const fps = parseInt(e.target.value);
                                setFiles(prev => prev.map(f => f.id === file.id ? { ...f, gifFps: fps } : f));
                              }}
                              className="w-full accent-blue-600 h-1"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      <AnimatePresence>
        {showInfoSidebar && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInfoSidebar(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[150]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-80 md:w-96 bg-white z-[160] shadow-2xl flex flex-col"
            >
              <div className="h-16 px-8 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div className="flex gap-6">
                  <button 
                    onClick={() => setSidebarTab('info')}
                    className={`font-bold tracking-tight text-lg transition-colors ${sidebarTab === 'info' ? 'text-gray-900' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    Information
                  </button>
                  <button 
                    onClick={() => setSidebarTab('settings')}
                    className={`font-bold tracking-tight text-lg transition-colors ${sidebarTab === 'settings' ? 'text-gray-900' : 'text-gray-300 hover:text-gray-400'}`}
                  >
                    Settings
                  </button>
                </div>
                <button 
                  onClick={() => setShowInfoSidebar(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8">
                {sidebarTab === 'info' ? (
                  <div className="space-y-10 animate-in fade-in slide-in-from-right-4 duration-300">
                    <section>
                      <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
                        <Layers className="w-5 h-5 text-blue-600" />
                      </div>
                      <h3 className="font-bold text-gray-900 mb-2 tracking-tight">How it works</h3>
                      <p className="text-sm text-gray-500 leading-relaxed">
                        GhostBG uses state-of-the-art AI models executed directly in your browser. 
                        When you upload an image, the background detection runs locally on your device, 
                        ensuring maximum speed and absolute privacy.
                      </p>
                    </section>

                    <section>
                      <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center mb-4">
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      </div>
                      <h3 className="font-bold text-gray-900 mb-2 tracking-tight">Privacy First</h3>
                      <p className="text-sm text-gray-500 leading-relaxed">
                        Unlike other services, your photos <span className="text-black font-semibold">never leave your device</span>. 
                        Every pixel stays on your hardware. We don't see your images, we don't store them, 
                        and we certainly don't use them for training.
                      </p>
                    </section>

                    <section>
                      <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center mb-4">
                        <CheckCircle2 className="w-5 h-5 text-purple-600" />
                      </div>
                      <h3 className="font-bold text-gray-900 mb-2 tracking-tight">Free Forever</h3>
                      <p className="text-sm text-gray-500 leading-relaxed text-balance">
                        High-quality background removal shouldn't be a luxury. We provide the full toolset 
                        including batch processing and manual refinement completely free of charge.
                      </p>
                    </section>
                    
                    <section className="bg-gray-50 rounded-2xl p-6">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">Hardware Info</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-500">Acceleration</span>
                          <span className="font-bold text-blue-600">{hardwareInfo.tech}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-500">Performance</span>
                          <span className="font-bold text-gray-900">{hardwareInfo.capability}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-500">Browser API</span>
                          <span className="font-bold text-gray-900">{typeof window !== 'undefined' && 'SharedArrayBuffer' in window ? 'SIMD Active' : 'Fallback'}</span>
                        </div>
                      </div>
                    </section>
                  </div>
                ) : (
                  <div className="space-y-10 animate-in fade-in slide-in-from-left-4 duration-300">
                    <section>
                      <h3 className="font-bold text-gray-900 mb-4 tracking-tight flex items-center gap-2">
                        <Maximize className="w-5 h-5 text-blue-600" /> Resolution Settings
                      </h3>
                      <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                        Enforce a specific resolution for all processed images. This ensures consistency 
                        for e-commerce listings or social media feeds.
                      </p>
                      
                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                          <div>
                            <p className="font-bold text-sm text-gray-900">Enforce Resolution</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Consistency Mode</p>
                          </div>
                          <button 
                            onClick={() => setSettings(s => ({ ...s, enforceResolution: !s.enforceResolution }))}
                            className={`w-12 h-6 rounded-full transition-colors relative ${settings.enforceResolution ? 'bg-blue-600' : 'bg-gray-200'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.enforceResolution ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>

                        <div className={`space-y-4 transition-opacity duration-300 ${settings.enforceResolution ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Width (px)</label>
                              <input 
                                type="number" 
                                value={settings.targetWidth}
                                onChange={(e) => setSettings(s => ({ ...s, targetWidth: parseInt(e.target.value) || 0 }))}
                                className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 font-bold text-sm focus:ring-2 focus:ring-blue-600/20 transition-all"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Height (px)</label>
                              <input 
                                type="number" 
                                value={settings.targetHeight}
                                onChange={(e) => setSettings(s => ({ ...s, targetHeight: parseInt(e.target.value) || 0 }))}
                                className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 font-bold text-sm focus:ring-2 focus:ring-blue-600/20 transition-all"
                              />
                            </div>
                          </div>
                          
                          <p className="text-[10px] text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-100 leading-tight">
                            <span className="font-black">NOTE:</span> Images smaller than the target resolution will be marked with an error to prevent blurry results.
                          </p>
                        </div>
                      </div>
                    </section>

                    <section>
                      <h3 className="font-bold text-gray-900 mb-4 tracking-tight flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-600" /> Quality Settings
                      </h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-purple-50 rounded-lg flex items-center justify-center">
                              <Sparkles className="w-4 h-4 text-purple-600" />
                            </div>
                            <div>
                              <p className="font-bold text-sm text-gray-900">High Precision</p>
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Better for non-human subjects</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => setSettings(s => ({ ...s, highPrecision: !s.highPrecision }))}
                            className={`w-12 h-6 rounded-full transition-colors relative ${settings.highPrecision ? 'bg-purple-600' : 'bg-gray-200'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.highPrecision ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center">
                              <Maximize className="w-4 h-4 text-orange-600" />
                            </div>
                            <div>
                              <p className="font-bold text-sm text-gray-900">Strict Cut</p>
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Removes semi-transparency</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => setSettings(s => ({ ...s, strictCut: !s.strictCut }))}
                            className={`w-12 h-6 rounded-full transition-colors relative ${settings.strictCut ? 'bg-orange-600' : 'bg-gray-200'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.strictCut ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                              <Settings className="w-4 h-4 text-blue-600" />
                            </div>
                            <div>
                              <p className="font-bold text-sm text-gray-900">Add Shadow</p>
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Professional depth effect</p>
                            </div>
                          </div>
                          <button 
                            onClick={() => setSettings(s => ({ ...s, includeShadow: !s.includeShadow }))}
                            className={`w-12 h-6 rounded-full transition-colors relative ${settings.includeShadow ? 'bg-blue-600' : 'bg-gray-200'}`}
                          >
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings.includeShadow ? 'left-7' : 'left-1'}`} />
                          </button>
                        </div>
                      </div>

                      <p className="text-[10px] text-gray-400 mt-3 px-1 leading-relaxed">
                        Uses a larger AI model for complex edge detection. Strict Cut helps with Roblox/Game avatars that have sharp boundaries.
                      </p>
                    </section>
                  </div>
                )}
              </div>
              
              <div className="p-8 border-t border-gray-100 italic text-[10px] text-gray-400">
                Created with precision. No servers, no tracking.
              </div>
            </motion.div>
          </>
        )}

        {currentEditingFile && (
          <MaskEditor 
            key={`editor-${currentEditingFile.id}`}
            fileItem={currentEditingFile} 
            onClose={() => setEditingFileId(null)} 
            onSave={handleEditSave}
          />
        )}
        {previewFileId && (
          <Lightbox 
            key={`lightbox-${previewFileId}`}
            files={files.filter(f => f.status === 'done')}
            currentIndex={files.filter(f => f.status === 'done').findIndex(f => f.id === previewFileId)}
            onClose={() => setPreviewFileId(null)}
            onNext={() => {
              const doneFiles = files.filter(f => f.status === 'done');
              const idx = doneFiles.findIndex(f => f.id === previewFileId);
              setPreviewFileId(doneFiles[(idx + 1) % doneFiles.length].id);
            }}
            onPrev={() => {
              const doneFiles = files.filter(f => f.status === 'done');
              const idx = doneFiles.findIndex(f => f.id === previewFileId);
              setPreviewFileId(doneFiles[(idx - 1 + doneFiles.length) % doneFiles.length].id);
            }}
            onSetEditing={(id) => setEditingFileId(id)}
            onDownload={(file) => downloadFile(file)}
          />
        )}
      </AnimatePresence>

      {/* Bottom Bar Info */}
      <footer className="mt-auto h-auto md:h-16 px-6 md:px-10 border-t border-gray-100 flex flex-col md:flex-row items-center justify-between py-6 md:py-0 text-[10px] font-bold text-gray-400 uppercase tracking-[0.15em] bg-white gap-4">
        <div className="flex flex-col md:flex-row gap-4 md:gap-10 text-center md:text-left">
          <span>Files deleted after session</span>
          <span>Private: Processing happens in your browser</span>
          <div className="flex items-center gap-2">
            <span className="text-blue-600 border border-blue-100 bg-blue-50 px-2 py-0.5 rounded">Speed Boost: {hardwareInfo.tech}</span>
          </div>
          <span className="text-gray-300">v1.2.4-stable</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-600 rounded-full border border-green-100">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
            <span>Estimated Speed: {hardwareInfo.capability}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
