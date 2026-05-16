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
  Layers
} from 'lucide-react';
import { removeBackground } from '@imgly/background-removal';
import JSZip from 'jszip';

// --- Types ---

interface ProcessedFile {
  id: string;
  file: File;
  preview: string;
  processedUrl: string | null;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
  progress: number;
}

// --- App Component ---

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

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
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      processedUrl: null,
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
      // Configuration for high quality
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
          <a href="#" className="px-5 py-2 bg-gray-900 text-white rounded-full hover:bg-black transition-all">Free Forever</a>
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
            Upload multiple images and let our AI do the heavy lifting. <br className="hidden md:block" /> Fast, precise, and completely free.
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
                    <div className="aspect-square bg-gray-50 rounded-xl overflow-hidden relative border border-gray-50">
                       <img 
                          src={file.processedUrl || file.preview} 
                          className={`w-full h-full object-contain p-2 transition-all duration-700 ${file.status === 'processing' ? 'scale-90 opacity-40 blur-sm' : 'scale-100 opacity-100'}`} 
                          alt="Preview" 
                        />
                       
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
                        <div className="absolute bottom-2 left-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-300">
                          <button 
                             onClick={() => removeFile(file.id)}
                             className="p-2 bg-white/90 backdrop-blur text-red-500 hover:bg-red-50 rounded-lg shadow-sm transition-colors"
                          >
                             <Trash2 className="w-4 h-4" />
                          </button>
                          {file.status === 'done' ? (
                             <button 
                               onClick={() => downloadFile(file)}
                               className="flex-1 bg-white/90 backdrop-blur text-gray-900 border border-gray-100 font-bold text-xs py-2 rounded-lg shadow-sm hover:bg-white transition-colors flex items-center justify-center gap-1.5"
                             >
                               <Download className="w-3.5 h-3.5 text-blue-600" /> Save
                             </button>
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
