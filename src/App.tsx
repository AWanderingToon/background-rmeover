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
  ChevronRight
} from 'lucide-react';
import { removeBackground } from '@imgly/background-removal';
import JSZip from 'jszip';

// --- Types ---

interface ProcessedFile {
  id: string;
  file: File;
  preview: string;
  processedUrl: string | null;
  maskUrl: string | null; // Added to store the refinement mask
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
  progress: number;
}

// --- MaskEditor Component ---

interface MaskEditorProps {
  fileItem: ProcessedFile;
  onSave: (processedUrl: string) => void;
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

  useEffect(() => {
    const setupCanvases = async () => {
      const img = new Image();
      img.src = fileItem.preview;
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

      if (fileItem.processedUrl) {
        const resultImg = new Image();
        resultImg.src = fileItem.processedUrl;
        await new Promise(resolve => resultImg.onload = resolve);
        
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
  }, [fileItem]);

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
    
    onSave(canvas.toDataURL('image/png'));
  };

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
          <h2 className="font-bold tracking-tight text-gray-900 truncate max-w-[200px]">{fileItem.file.name}</h2>
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
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
          >
            Finished
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden bg-gray-50">
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

          <section className="mt-8 pt-8 border-t border-gray-50">
             <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">Controls</h4>
             <ul className="text-[10px] font-bold text-gray-400 space-y-2 uppercase tracking-wider">
               <li className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center text-[8px]"><MousePointer2 className="w-2 h-2" /></div> Middle Click to Pan</li>
               <li className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center text-[8px]">WHL</div> Scroll to Zoom</li>
               <li className="flex items-center gap-2"><div className="w-4 h-4 bg-gray-100 rounded flex items-center justify-center text-[8px]">ALT</div> + Drag to Pan</li>
             </ul>
          </section>
        </div>

        <div className="flex-1 relative overflow-auto p-12 flex items-center justify-center select-none bg-gray-100/50">
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
          </div>
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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFiles = (Array.from(e.dataTransfer.files) as File[]).filter(file => file.type.startsWith('image/'));
    addFiles(droppedFiles);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = (Array.from(e.target.files) as File[]).filter(file => file.type.startsWith('image/'));
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
      progress: 0
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

  const processFile = async (id: string) => {
    const fileItem = files.find(f => f.id === id);
    if (!fileItem || fileItem.status === 'processing') return;

    setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'processing', progress: 10 } : f));

    try {
      const blob = await removeBackground(fileItem.file, {
        progress: (p: any) => {
           setFiles(prev => prev.map(f => f.id === id ? { ...f, progress: Math.round((p as number) * 100) } : f));
        }
      });
      const url = URL.createObjectURL(blob);
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
    link.download = `${fileItem.file.name.split('.')[0]}_no_bg.png`;
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
      zip.file(`${file.file.name.split('.')[0]}_no_bg.png`, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'removed_backgrounds.zip';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleEditSave = (processedUrl: string) => {
    if (!editingFileId) return;
    setFiles(prev => prev.map(f => f.id === editingFileId ? { ...f, processedUrl } : f));
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
          <a href="#" className="hover:text-black transition-colors">How it works</a>
          <a href="#" className="hover:text-black transition-colors">Privacy</a>
          <a href="#" className="px-5 py-2 bg-gray-900 text-white rounded-full hover:bg-black transition-all font-bold">Free Forever</a>
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
              accept="image/*"
              onChange={onFileChange}
            />
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
              <Upload className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900">Drop files here or click to upload</h3>
            <p className="text-gray-400 text-sm mt-2 uppercase tracking-widest font-bold">PNG, JPG, WebP up to 10MB</p>
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
                <input id="file-upload-more" type="file" multiple className="hidden" accept="image/*" onChange={onFileChange} />
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
                         className={`w-full h-full p-2 transition-all duration-700 ${file.status === 'processing' ? 'scale-90 opacity-40 blur-sm' : 'scale-100 opacity-100'} ${file.status === 'done' ? 'bg-transparency' : ''}`}
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
                        {file.status === 'processing' && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
                            <div className="bg-white/80 px-2 py-0.5 rounded-full">
                               <p className="text-[10px] font-black text-blue-600 tracking-tighter">{file.progress}%</p>
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
                                 className="p-2 bg-white/90 backdrop-blur text-blue-600 border border-gray-100 rounded-lg shadow-sm hover:bg-white transition-colors"
                               >
                                 <Download className="w-4 h-4" />
                               </button>
                             </>
                          ) : (
                             <button 
                               onClick={() => processFile(file.id)}
                               disabled={file.status === 'processing'}
                               className="flex-1 bg-blue-600 text-white font-bold text-xs py-2 rounded-lg shadow-sm hover:bg-blue-700 transition-colors flex items-center justify-center"
                             >
                               Remove BG
                             </button>
                          )}
                        </div>
                    </div>

                    <div className="px-1 flex items-center justify-between min-w-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 truncate tracking-tight">{file.file.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                           <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{(file.file.size / 1024 / 1024).toFixed(2)} MB</p>
                           {file.status === 'done' && (
                             <span className="w-1 h-1 bg-gray-300 rounded-full" />
                           )}
                           <p className={`text-[10px] font-bold uppercase tracking-widest ${
                             file.status === 'done' ? 'text-green-500' : 
                             file.status === 'processing' ? 'text-blue-500' : 
                             file.status === 'error' ? 'text-red-500' : 'text-gray-300'
                           }`}>
                             {file.status === 'done' ? 'Ready' : 
                              file.status === 'processing' ? 'Processing' : 
                              file.status === 'error' ? 'Failed' : 'Pending'}
                           </p>
                        </div>
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
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-600 rounded-full border border-green-100">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
            <span>System Status: Optimal</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
