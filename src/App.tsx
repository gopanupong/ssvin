import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  MapPin, 
  CheckCircle2, 
  ChevronRight, 
  LogOut, 
  LayoutDashboard, 
  ClipboardCheck, 
  Upload,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  FileText,
  Plus,
  MonitorOff,
  Clock,
  Search,
  Sliders,
  Info,
  Shield,
  Wrench,
  Sparkles
} from 'lucide-react';
import { cn, SUBSTATIONS, InspectionLog } from './constants';
import { format } from 'date-fns';
import { th } from 'date-fns/locale';
import imageCompression from 'browser-image-compression';

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'danger' }) => {
  const variants = {
    primary: 'bg-violet-600 text-white hover:bg-violet-700 shadow-violet-200',
    secondary: 'bg-slate-800 text-white hover:bg-slate-900',
    outline: 'border-2 border-slate-200 text-slate-600 hover:bg-slate-50',
    danger: 'bg-rose-500 text-white hover:bg-rose-600',
  };
  return (
    <button 
      className={cn(
        'px-6 py-3 rounded-xl font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2',
        variants[variant],
        className
      )}
      {...props}
    />
  );
};

const Card = ({ children, className, onClick, ...props }: { children: React.ReactNode; className?: string; onClick?: () => void; [key: string]: any }) => (
  <div 
    onClick={onClick}
    className={cn('bg-white rounded-2xl shadow-sm border border-slate-100 p-6', className)}
    {...props}
  >
    {children}
  </div>
);

// --- Pages ---

const CATEGORY_LABELS: {[key: string]: string} = {
  yard: 'ลานไกไฟฟ้า',
  roof: 'หลังคาอาคาร',
  battery: 'แบตเตอรี่',
  security: 'รปภ.',
  fence: 'รั้วสถานี',
  checklist: 'Check List',
};

const LoginPage = ({ onLogin }: { onLogin: (id: string) => void }) => {
  const [id, setId] = useState('');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (id.length === 6) {
      onLogin(id);
    }
  };

  return (
    <div className="min-h-screen bg-violet-50 flex flex-col items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md text-center"
      >
        <div className="mb-8 flex justify-center">
          <div className="w-24 h-24 bg-violet-600 rounded-3xl flex items-center justify-center shadow-xl shadow-violet-200">
            <ClipboardCheck className="text-white w-12 h-12" />
          </div>
        </div>
        
        <h1 className="text-2xl font-bold text-slate-900 mb-2">ระบบตรวจสอบสถานีไฟฟ้า (SSVI)</h1>
        <p className="text-slate-500 mb-8 italic">Smart Substation Visual Inspection</p>

        <Card>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2 text-left">
                รหัสพนักงาน 6 หลัก
              </label>
              <input
                type="text"
                maxLength={6}
                pattern="\d*"
                inputMode="numeric"
                value={id}
                onChange={(e) => setId(e.target.value.replace(/\D/g, ''))}
                placeholder="• • • • • •"
                className="w-full text-center text-3xl tracking-[0.5em] py-4 rounded-xl border-2 border-slate-100 focus:border-violet-500 focus:ring-0 transition-all font-mono"
                autoFocus
              />
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={id.length !== 6}
            >
              ยืนยัน <ChevronRight size={20} />
            </Button>
          </form>
        </Card>
        
        <div className="mt-8 flex flex-col items-center gap-4">
          <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">
            Power Inspection System v1.0
          </p>
          <a 
            href="/api/auth/google" 
            className="text-[10px] text-slate-300 hover:text-violet-400 transition-colors"
          >
            ตั้งค่าการเชื่อมต่อ Google (สำหรับผู้ดูแล)
          </a>
        </div>
      </motion.div>
    </div>
  );
};

const SelectionPage = ({ onSelect, onLogout }: { onSelect: (sub: typeof SUBSTATIONS[0]) => void; onLogout: () => void }) => {
  const [sortedSubstations, setSortedSubstations] = useState<(typeof SUBSTATIONS[0] & { distance?: number })[]>(SUBSTATIONS);
  const [loading, setLoading] = useState(true);
  const [nearestSub, setNearestSub] = useState<(typeof SUBSTATIONS[0] & { distance?: number }) | null>(null);

  // Haversine formula for accurate distance in km
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        
        const withDistance = SUBSTATIONS.map(sub => {
          const km = calculateDistance(latitude, longitude, sub.lat, sub.lng);
          return { ...sub, distance: km };
        });

        const sorted = [...withDistance].sort((a, b) => (a.distance || 0) - (b.distance || 0));
        setSortedSubstations(sorted);
        
        // If the nearest is within 2km, consider it "detected"
        if (sorted[0].distance && sorted[0].distance <= 2) {
          setNearestSub(sorted[0]);
        }
        
        setLoading(false);
      },
      (err) => {
        console.error("Geolocation error:", err);
        setLoading(false);
      },
      { enableHighAccuracy: true }
    );
  }, []);

  const nearbySubstations = sortedSubstations.filter(sub => sub.distance !== undefined && sub.distance <= 10);
  const displayNearby = nearbySubstations.length > 0 ? nearbySubstations : sortedSubstations.slice(0, 3);
  const otherSubstations = sortedSubstations.filter(sub => !displayNearby.find(n => n.id === sub.id));

  return (
    <div className="min-h-screen bg-violet-50 p-6 pb-24">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-bold text-slate-900">เลือกสถานีไฟฟ้า</h2>
          <button onClick={onLogout} className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
            <LogOut size={20} />
          </button>
        </div>

        <AnimatePresence>
          {nearestSub && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="mb-8"
            >
              <Card className="bg-violet-600 text-white border-none shadow-xl shadow-violet-200 overflow-hidden relative p-0">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <MapPin size={100} />
                </div>
                <div className="p-6 relative z-10">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="bg-white/20 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin" /> ตรวจพบสถานีใกล้เคียง
                    </span>
                    <span className="text-[10px] font-bold opacity-70">ห่างจากคุณ {nearestSub.distance?.toFixed(2)} กม.</span>
                  </div>
                  <h3 className="text-2xl font-bold mb-4 leading-tight">{nearestSub.name}</h3>
                  <Button 
                    variant="secondary" 
                    onClick={() => onSelect(nearestSub)}
                    className="w-full bg-white text-violet-600 hover:bg-violet-50 border-none h-12"
                  >
                    เริ่มการตรวจสอบทันที <ChevronRight size={18} />
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-8">
          <section>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">สถานีแนะนำใกล้คุณ</p>
            <div className="space-y-3">
              {displayNearby.map((sub, idx) => (
                <motion.div 
                  key={sub.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onSelect(sub)}
                  className={cn(
                    "p-5 rounded-2xl shadow-sm cursor-pointer relative overflow-hidden group transition-all",
                    nearestSub?.id === sub.id ? "bg-violet-50 border-2 border-violet-200" : "bg-white border border-slate-100"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                        nearestSub?.id === sub.id ? "bg-violet-600 text-white" : "bg-slate-50 text-slate-400 group-hover:bg-violet-50 group-hover:text-violet-600"
                      )}>
                        <MapPin size={24} />
                      </div>
                      <div className="text-left">
                        <p className={cn("font-bold", nearestSub?.id === sub.id ? "text-violet-900" : "text-slate-800")}>{sub.name}</p>
                        {sub.distance !== undefined && (
                          <p className="text-xs text-slate-400 font-medium">ห่างจากคุณ {sub.distance.toFixed(1)} กม.</p>
                        )}
                      </div>
                    </div>
                    <ChevronRight size={20} className={cn("transition-all", nearestSub?.id === sub.id ? "text-violet-400" : "text-slate-300 group-hover:text-violet-500 group-hover:translate-x-1")} />
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          <section>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">สถานีอื่นๆ</p>
            <div className="space-y-3">
              {otherSubstations.map((sub) => (
                <div key={sub.id}>
                  <Card className="p-0 overflow-hidden">
                    <button 
                      onClick={() => onSelect(sub)}
                      className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
                    >
                      <div>
                        <h4 className="font-bold text-slate-800">{sub.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-slate-500">สถานีไฟฟ้าแรงสูง</p>
                          {sub.distance !== undefined && (
                            <>
                              <span className="text-[10px] text-slate-300">•</span>
                              <p className="text-[10px] font-bold text-violet-600">~ {sub.distance.toFixed(1)} กม.</p>
                            </>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-slate-300" />
                    </button>
                  </Card>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const InspectionPage = ({ substation, employeeId, onBack, onComplete }: { substation: typeof SUBSTATIONS[0]; employeeId: string; onBack: () => void; onComplete: () => void }) => {
  const [photos, setPhotos] = useState<{ [key: string]: { file: File; comment: string }[] }>({
    yard: [],
    roof: [],
    battery: [],
    security: [],
    fence: [],
  });
  const [enabledCategories, setEnabledCategories] = useState<string[]>(['yard', 'roof', 'battery', 'security', 'fence', 'checklist']);

  const toggleCategory = (id: string) => {
    setEnabledCategories(prev => 
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };
  const [checklists, setChecklists] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const isSubmitting = useRef(false);
  const [status, setStatus] = useState<string>('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(true);
  const [showConfirm, setShowConfirm] = useState(false);
  
  const getGeoLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("เบราว์เซอร์ไม่รองรับ GPS");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationError(null);
        console.log("Location captured:", pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        console.error("Geolocation error:", err);
        let msg = "ไม่สามารถระบุตำแหน่งได้";
        if (err.code === 1) msg = "กรุณาอนุญาตการเข้าถึงตำแหน่ง (GPS)";
        else if (err.code === 2) msg = "ไม่พบสัญญาณ GPS";
        else if (err.code === 3) msg = "หมดเวลาการค้นหาตำแหน่ง";
        setLocationError(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const checkDevice = () => {
    const ua = navigator.userAgent;
    const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(ua);
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isIPadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const finalIsMobile = isMobileDevice || isIPadOS || hasTouch;
    setIsMobile(finalIsMobile);
  };

  useEffect(() => {
    checkDevice();
    getGeoLocation();
    
    // Check Drive status
    fetch('/api/drive/status')
      .then(res => res.json())
      .then(data => {
        if (!data.connected) {
          alert("⚠️ คำเตือน: ระบบยังไม่ได้เชื่อมต่อ Google Drive กรุณาแจ้งผู้ดูแลระบบให้ตั้งค่า GOOGLE_REFRESH_TOKEN ก่อนส่งรายงาน");
        }
      })
      .catch(err => console.error("Failed to fetch drive status:", err));
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>, key: string) => {
    const file = e.target.files?.[0];
    
    if (file && key) {
      const now = Date.now();
      const fileTime = file.lastModified;
      const diffSeconds = Math.abs(now - fileTime) / 1000;
      
      // Strict validation for Live Photo
      // Reduce to 60 seconds (1 minute) to ensure it's a fresh photo taken via camera
      const maxAllowedDiff = 60;

      // Expanded list of patterns that indicate a file from an album/gallery or other apps
      const fileName = file.name.toLowerCase();
      const albumPatterns = [
        'screenshot', 'fb_img', 'line_album', 'save', 'download', 
        'whatsapp', 'telegram', 'facebook', 'messenger', 'instagram',
        'viber', 'wechat', 'snapchat', 'tiktok', 'twitter', 'x_img',
        'image_', 'img_', 'dsc_', 'photo_', 'pixel_', 'samsung_', 'huawei_',
        'oppo_', 'vivo_', 'xiaomi_', 'realme_', 'iphone_', 'apple_',
        'shared_', 'copy_', 'edit_', 'modified_', 'resized_', 'compressed_',
        'gallery', 'album', 'photos', 'camera_roll', 'dcim'
      ];

      const isLikelyAlbum = albumPatterns.some(pattern => fileName.includes(pattern));

      if (diffSeconds > maxAllowedDiff || isLikelyAlbum) {
        let reason = "";
        if (isLikelyAlbum) {
          reason = "ตรวจพบชื่อไฟล์ที่มาจากอัลบั้ม, แกลเลอรี หรือแอปพลิเคชันอื่น";
        } else {
          reason = `รูปภาพนี้ถูกถ่ายไว้นานเกินไป (${Math.round(diffSeconds)} วินาทีที่แล้ว)\nระบบอนุญาตให้ส่งเฉพาะภาพที่ถ่ายสดใหม่ภายใน ${maxAllowedDiff} วินาทีเท่านั้น`;
        }

        alert(`❌ ระบบปิดใช้งานการเลือกรูปจากอัลบั้ม (ทุก Browser)\n\nเหตุผล: ${reason}\n\nคำแนะนำ:\n1. กรุณากดปุ่ม 'ถ่ายภาพ' อีกครั้ง\n2. เลือก 'กล้อง' (Camera) เพื่อถ่ายภาพใหม่ทันที\n3. ห้ามเลือกจาก 'คลังรูปภาพ' (Photo Library) หรือ 'ไฟล์' (Files)`);
        
        e.target.value = '';
        return;
      }

      if (key === 'checklist') {
        setChecklists(prev => [...prev, file]);
      } else {
        setPhotos(prev => ({ ...prev, [key]: [...prev[key], { file, comment: '' }] }));
      }
    }
    e.target.value = '';
  };

  const handleCommentChange = (key: string, index: number, comment: string) => {
    setPhotos(prev => {
      const newPhotos = { ...prev };
      newPhotos[key] = [...newPhotos[key]];
      newPhotos[key][index] = { ...newPhotos[key][index], comment };
      return newPhotos;
    });
  };

  const addTimestampToImage = (file: File, comment: string): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject('Could not get canvas context');

          // Draw original image
          ctx.drawImage(img, 0, 0);

          // Setup text style
          const fontSize = Math.max(20, Math.floor(canvas.width / 40));
          ctx.font = `bold ${fontSize}px sans-serif`;
          const timestamp = format(new Date(), 'dd/MM/yyyy HH:mm:ss', { locale: th });
          
          // Draw Timestamp (Bottom Right)
          const tsWidth = ctx.measureText(timestamp).width;
          const tsX = canvas.width - tsWidth - 20;
          const tsY = canvas.height - 20;

          // Draw Comment (Above Timestamp) if exists
          if (comment) {
            const commentText = comment;
            const cWidth = ctx.measureText(commentText).width;
            const cX = canvas.width - cWidth - 20;
            const cY = tsY - fontSize - 8; // Position above timestamp with a small gap

            ctx.strokeStyle = 'black';
            ctx.lineWidth = 4;
            ctx.strokeText(commentText, cX, cY);
            ctx.fillStyle = '#fde047'; // Yellow for comment
            ctx.fillText(commentText, cX, cY);
          }

          // Draw Timestamp
          ctx.strokeStyle = 'black';
          ctx.lineWidth = 4;
          ctx.strokeText(timestamp, tsX, tsY);
          ctx.fillStyle = 'white';
          ctx.fillText(timestamp, tsX, tsY);

          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject('Canvas to Blob failed');
          }, 'image/jpeg', 0.9);
        };
        img.src = event.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSubmit = async () => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    
    if (!employeeId) {
      alert('ไม่พบรหัสพนักงาน กรุณาล็อกอินใหม่');
      isSubmitting.current = false;
      return;
    }

    // Try to get location one last time if missing
    if (!location) {
      setStatus('กำลังระบุตำแหน่ง GPS...');
      try {
        await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              setLocation(loc);
              resolve(loc);
            },
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 5000 }
          );
        });
      } catch (e) {
        console.warn("Could not get location at submit time", e);
      }
    }
    
    setUploading(true);
    setStatus('กำลังเตรียมการอัปโหลด...');
    
    try {
      const now = new Date();
      const timeStr = format(now, 'HHmm');
      const dateStr = now.toLocaleDateString("th-TH", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      }).replace(/\//g, "");
      const nameSuffix = `${timeStr}_${dateStr}`;

      // 1. Initialize Upload (Get Token and Folder ID)
      const initRes = await fetch('/api/init-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ substationName: substation.name, timestamp: now.toISOString() })
      });
      
      if (!initRes.ok) {
        const errData = await initRes.json();
        throw new Error(errData.error || 'Failed to initialize upload');
      }
      
      const { accessToken, folderId } = await initRes.json();
      const categoriesInSubmission = new Set<string>();

      // Helper to upload directly to Google Drive
      const uploadToDrive = async (blob: Blob, filename: string) => {
        const metadata = {
          name: filename,
          parents: [folderId]
        };

        const formData = new FormData();
        formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        formData.append('file', blob);

        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          body: formData
        });

        if (!response.ok) {
          let errorMsg = response.statusText;
          try {
            const errorData = await response.json();
            errorMsg = errorData.error?.message || response.statusText;
          } catch (e) {
            // Ignore if not JSON
          }
          throw new Error(`Drive upload failed (${response.status}): ${errorMsg}`);
        }
        return await response.json();
      };

      const compressionOptions = {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1600,
        useWebWorker: true
      };

      // Process and Upload Fixed-Point photos
      const photoEntries = Object.entries(photos) as [string, {file: File, comment: string}[]][];
      let totalPhotos = 0;
      photoEntries.forEach(([_, items]) => totalPhotos += items.length);
      totalPhotos += checklists.length;
      
      let currentCount = 0;

      for (const [key, items] of photoEntries) {
        if (items.length > 0) categoriesInSubmission.add(key);
        for (let i = 0; i < items.length; i++) {
          currentCount++;
          setStatus(`กำลังประมวลผลรูปที่ ${currentCount}/${totalPhotos}...`);
          
          const processedBlob = await addTimestampToImage(items[i].file, items[i].comment);
          const processedFile = new File([processedBlob], 'temp.jpg', { type: 'image/jpeg' });
          const compressedBlob = await imageCompression(processedFile, compressionOptions);
          
          await uploadToDrive(compressedBlob, `${key}_${i + 1}_${nameSuffix}.jpg`);
        }
      }
      
      // Process and Upload Checklists
      if (checklists.length > 0) categoriesInSubmission.add('checklist');
      for (let i = 0; i < checklists.length; i++) {
        currentCount++;
        setStatus(`กำลังประมวลผลรูปที่ ${currentCount}/${totalPhotos}...`);
        
        const processedBlob = await addTimestampToImage(checklists[i], '');
        const processedFile = new File([processedBlob], 'temp.jpg', { type: 'image/jpeg' });
        const compressedBlob = await imageCompression(processedFile, compressionOptions);
        
        await uploadToDrive(compressedBlob, `checklist_${i + 1}_${nameSuffix}.jpg`);
      }

      // 3. Finalize: Log to DB and Sheets
      setStatus('กำลังบันทึกข้อมูลรายงาน...');
      const finalizeRes = await fetch('/api/complete-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          substationName: substation.name,
          lat: location?.lat || 0,
          lng: location?.lng || 0,
          timestamp: now.toISOString(),
          folderId,
          categories: Array.from(categoriesInSubmission).join(',')
        })
      });

      if (finalizeRes.ok) {
        onComplete();
      } else {
        const errData = await finalizeRes.json();
        alert(`บันทึกข้อมูลไม่สำเร็จ: ${errData.error}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setUploading(false);
      isSubmitting.current = false;
    }
  };

  const isReady = (Object.values(photos) as {file: File, comment: string}[][]).some(items => items.length > 0) || checklists.length > 0;

  return (
    <div className="min-h-screen bg-violet-50 p-6 pb-32">
      {/* Desktop Restriction Overlay */}
      {!isMobile && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[9999] flex items-center justify-center p-6 text-center">
          <div className="bg-white rounded-3xl p-8 max-w-md shadow-2xl">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <MonitorOff className="w-10 h-10 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">เข้าใช้งานผ่านคอมพิวเตอร์</h2>
            <p className="text-gray-600 mb-8 leading-relaxed">
              ขออภัย ระบบรายงานนี้ออกแบบมาเพื่อใช้หน้างานผ่าน <span className="font-bold text-gray-900">โทรศัพท์มือถือ หรือ แท็บเล็ต</span> เท่านั้น เพื่อความถูกต้องของข้อมูล GPS และการถ่ายภาพสด
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm mb-8">
              กรุณาสแกน QR Code หรือเข้าลิงก์เดิมผ่านอุปกรณ์พกพาของคุณ
            </div>
            <button 
              onClick={onBack}
              className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
            >
              กลับหน้าหลัก
            </button>
          </div>
        </div>
      )}

      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="p-2 -ml-2 text-slate-400 hover:text-slate-900">
            <ChevronRight size={24} className="rotate-180" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{substation.name}</h2>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-violet-600 uppercase tracking-wider">รายงานประจำเดือน</p>
              <span className="text-[10px] text-slate-300">•</span>
              <div className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${location ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                <span className="text-[10px] font-bold text-slate-400 uppercase">
                  {location ? 'GPS Active' : 'Waiting for GPS...'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="p-3 bg-violet-100 border border-violet-200 rounded-xl flex items-center gap-3 text-violet-700 text-[10px] font-bold uppercase tracking-wider">
            <Camera size={16} className="shrink-0" />
            <p>โหมดถ่ายภาพสดเท่านั้น: ปุ่มเลือกจากอัลบั้มถูกปิดใช้งานโดยระบบ</p>
          </div>

          {locationError && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 text-amber-700 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <div className="flex-1">
                <p className="font-bold">คำเตือน: {locationError}</p>
                <p className="opacity-80">พิกัด GPS อาจไม่ถูกบันทึก กรุณาลองเปิด-ปิด GPS ใหม่</p>
              </div>
              <button 
                onClick={getGeoLocation}
                className="bg-amber-200 px-2 py-1 rounded-lg font-bold hover:bg-amber-300 transition-colors"
              >
                ลองใหม่
              </button>
            </div>
          )}

          <section>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">จุดตรวจสอบมาตรฐาน (Fixed-Point)</p>
            <div className="space-y-6">
              {[
                { id: 'fence', label: 'รั้วสถานี', desc: 'ถ่ายภาพ ให้เห็นรั้วทั้ง 4 ด้าน จะมีอย่างน้อย 4 รูป', mandatory: true },
                { id: 'battery', label: 'แบตเตอรี่', desc: 'ถ่ายภาพรวม 1 รูป , ถ่ายเจาะจงให้เห็นระดับสูง-ต่ำ น้ำกลั่น อย่างน้อย 1 รูป', mandatory: true },
                { id: 'yard', label: 'ลานไก', desc: 'ถ่ายภาพรวม , ถ่ายมุมกว้าง ให้เห็นพื้นลานไกทั้งหมด' },
                { id: 'roof', label: 'ดาดฟ้า', desc: 'ถ้าขึ้นได้, ถ่ายภาพรวม , ถ่ายมุมกว้าง ให้เห็นพื้น ท่อระบายน้ำต่างๆ' },
                { id: 'security', label: 'รปภ.', desc: 'ถ้าสฟ. มี รปภ. ให้ถ่ายรูปการแต่งกายของ รปภ. (ถ้าไม่มีให้ปิดหัวข้อไว้ ไม่ต้องถ่าย)' },
              ].map((point) => {
                const isMandatory = (point as any).mandatory;
                const isEnabled = isMandatory || enabledCategories.includes(point.id);
                return (
                  <div 
                    key={point.id} 
                    className={cn(
                      "space-y-4 p-5 rounded-3xl border transition-all duration-300", 
                      isEnabled 
                        ? "bg-white border-slate-100 shadow-md shadow-slate-200/50" 
                        : "bg-slate-50 border-slate-200 opacity-70"
                    )}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className={cn("font-bold text-base", isEnabled ? "text-slate-900" : "text-slate-400")}>
                            {point.label}
                          </h4>
                          {isMandatory && (
                            <span className="bg-amber-100 text-amber-700 text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">
                              Mandatory
                            </span>
                          )}
                        </div>
                        <p className={cn("text-xs leading-relaxed", isEnabled ? "text-slate-500" : "text-slate-400")}>
                          {point.desc}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-3">
                        {!isMandatory ? (
                          <button
                            onClick={() => toggleCategory(point.id)}
                            className={cn(
                              "w-12 h-6 rounded-full relative transition-all duration-300 focus:outline-none shadow-inner",
                              isEnabled ? "bg-emerald-500" : "bg-slate-300"
                            )}
                          >
                            <div className={cn(
                              "absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-all duration-300 flex items-center justify-center",
                              isEnabled ? "left-7" : "left-1"
                            )}>
                              <div className={cn("w-1 h-1 rounded-full", isEnabled ? "bg-emerald-500" : "bg-slate-300")} />
                            </div>
                          </button>
                        ) : (
                          <div className="w-12 h-6 flex items-center justify-center">
                            <CheckCircle2 size={18} className="text-emerald-500" />
                          </div>
                        )}
                        
                        {isEnabled && (
                          <label className="bg-violet-600 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 active:scale-90 transition-all cursor-pointer shadow-lg shadow-violet-200">
                            <Camera size={16} />
                            <span>ถ่ายภาพ</span>
                            <input 
                              type="file" 
                              accept="image/*" 
                              capture="environment" 
                              className="hidden" 
                              onChange={(e) => onFileChange(e, point.id)} 
                            />
                          </label>
                        )}
                      </div>
                    </div>
                    
                    {isEnabled && (
                      <div className="grid grid-cols-1 gap-4 pt-2">
                        {photos[point.id].map((item, i) => (
                          <div key={i} className="bg-slate-50 p-3 rounded-2xl border border-slate-100 space-y-3">
                            <div className="aspect-video bg-slate-200 rounded-xl overflow-hidden relative group shadow-inner">
                              <img src={URL.createObjectURL(item.file)} className="w-full h-full object-cover" />
                              <button 
                                onClick={() => setPhotos(prev => ({
                                  ...prev,
                                  [point.id]: prev[point.id].filter((_, idx) => idx !== i)
                                }))}
                                className="absolute top-2 right-2 w-8 h-8 bg-rose-500/90 backdrop-blur-sm text-white rounded-full flex items-center justify-center shadow-lg active:scale-75 transition-all"
                              >
                                <Plus size={20} className="rotate-45" />
                              </button>
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">บันทึกเพิ่มเติม</p>
                              <input 
                                type="text"
                                placeholder="พิมพ์รายละเอียดที่นี่..."
                                value={item.comment}
                                onChange={(e) => handleCommentChange(point.id, i, e.target.value)}
                                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-violet-500 outline-none shadow-sm"
                              />
                            </div>
                          </div>
                        ))}
                        {photos[point.id].length === 0 && (
                          <div className="py-10 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-300 bg-slate-50/50">
                            <ImageIcon size={32} className="mb-2 opacity-20" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">ยังไม่มีรูปภาพ</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white p-5 rounded-3xl border border-slate-100 shadow-md shadow-slate-200/50">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-violet-600 animate-pulse" />
                <p className="text-sm font-bold text-slate-900 uppercase tracking-tight">กระดาษ Check List (A4)</p>
              </div>
              <span className="text-[10px] font-black text-violet-600 bg-violet-50 px-2 py-1 rounded-full border border-violet-100">
                {checklists.length} แผ่น
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">ถ่ายกระดาษ Check List ทุกหน้าให้ครบถ้วน</p>
            
            <div className="grid grid-cols-3 gap-3">
                {checklists.map((file, i) => (
                  <div key={i} className="aspect-square bg-slate-200 rounded-2xl overflow-hidden relative group shadow-inner">
                    <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setChecklists(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute top-1 right-1 w-6 h-6 bg-rose-500/90 backdrop-blur-sm text-white rounded-full flex items-center justify-center shadow-lg text-xs active:scale-75 transition-all"
                    >
                      <Plus size={14} className="rotate-45" />
                    </button>
                  </div>
                ))}
                <label className="aspect-square border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-400 hover:border-violet-500 hover:text-violet-500 transition-all cursor-pointer bg-slate-50/50 active:bg-violet-50">
                  <Camera size={24} className="opacity-40" />
                  <span className="text-[9px] font-black uppercase tracking-widest mt-2">ถ่ายภาพ</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment" 
                    className="hidden" 
                    onChange={(e) => onFileChange(e, 'checklist')} 
                  />
                </label>
              </div>
          </section>
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-100 shadow-2xl">
          <div className="max-w-md mx-auto">
            <Button 
              onClick={() => setShowConfirm(true)} 
              className="w-full h-14 text-lg" 
              disabled={!isReady || uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="animate-spin" /> {status || 'กำลังส่งข้อมูล...'}
                </>
              ) : (
                <>
                  <Upload size={20} /> ส่งรายงานประจำเดือน
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Confirmation Modal */}
        <AnimatePresence>
          {showConfirm && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[10000] flex items-center justify-center p-6">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center"
              >
                <div className="w-20 h-20 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Upload className="w-10 h-10 text-violet-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">ยืนยันการส่งรายงาน</h3>
                <p className="text-slate-500 text-sm mb-8">คุณยืนยันที่จะส่งรายงานประจำเดือนของสถานี {substation.name} หรือไม่?</p>
                
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => setShowConfirm(false)}
                    className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors"
                  >
                    ไม่ใช่
                  </button>
                  <button 
                    onClick={() => {
                      setShowConfirm(false);
                      handleSubmit();
                    }}
                    className="py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-lg shadow-violet-200 transition-colors"
                  >
                    ใช่
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const DashboardPage = ({ onBack }: { onBack: () => void }) => {
  const [stats, setStats] = useState<{ total: number; totalSubmissions: number; recent: InspectionLog[] }>({ total: 0, totalSubmissions: 0, recent: [] });
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showInspectedModal, setShowInspectedModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'progress' | 'health'>('progress');
  const [healthIndex, setHealthIndex] = useState<any[]>([]);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [selectedSubstationForAnalysis, setSelectedSubstationForAnalysis] = useState<string | null>(null);
  const [imagesInFolder, setImagesInFolder] = useState<any[]>([]);
  const [isFetchingImages, setIsFetchingImages] = useState(false);
  const [isBatchAnalyzing, setIsBatchAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const stopBatchRef = useRef(false);
  const [currentlyAnalyzingId, setCurrentlyAnalyzingId] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState({ total: 0, clean: 0, issues: 0, weeds: 0, birdDroppings: 0 });
  
  const [selectedSubForAudit, setSelectedSubForAudit] = useState<any | null>(null);
  const [isSavingAudit, setIsSavingAudit] = useState(false);
  const [isRerunningAI, setIsRerunningAI] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGradeFilter, setActiveGradeFilter] = useState<string | null>(null);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [driveStatus, setDriveStatus] = useState<{ connected: boolean; configured: boolean } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const checkDriveStatus = () => {
    fetch('/api/drive/status')
      .then(res => res.json())
      .then(data => setDriveStatus(data))
      .catch(err => console.error("Failed to fetch drive status:", err));
  };

  useEffect(() => {
    checkDriveStatus();
  }, []);

  const testDriveConnection = async () => {
    setTestingConnection(true);
    try {
      const res = await fetch('/api/drive/subfolders/root');
      const data = await res.json();
      if (res.ok) {
        alert("✅ เชื่อมต่อ Google Drive สำเร็จ! สามารถอ่านข้อมูลได้ปกติ");
      } else {
        alert(`❌ การเชื่อมต่อล้มเหลว: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setTestingConnection(false);
      checkDriveStatus();
    }
  };

  const fetchImagesInFolder = async (folderId: string) => {
    setSelectedFolderId(folderId);
    setIsFetchingImages(true);
    try {
      const res = await fetch(`/api/drive/folder/${folderId}/images`);
      const data = await res.json();
      setImagesInFolder(data);
      updateAnalysisSummary(data);
    } catch (err) {
      console.error("Failed to fetch images:", err);
    } finally {
      setIsFetchingImages(false);
    }
  };

  const updateAnalysisSummary = (images: any[]) => {
    const summary = images.reduce((acc, img) => {
      acc.total++;
      if (img.analysis && !img.analysis.error) {
        if (img.analysis.status === 'Green') {
          acc.clean++;
        } else if (img.analysis.status === 'Red') {
          acc.issues++;
          if (img.analysis.findings && Array.isArray(img.analysis.findings)) {
            if (img.analysis.findings.includes('Weed')) acc.weeds++;
            if (img.analysis.findings.includes('Bird Droppings')) acc.birdDroppings++;
          }
        }
      }
      return acc;
    }, { total: 0, clean: 0, issues: 0, weeds: 0, birdDroppings: 0 });
    setAnalysisSummary(summary);
  };

  const handleAnalyzeImage = async (image: any, folderId: string, silent = false) => {
    if (image.analysis && !image.analysis.error) {
      return image.analysis;
    }
    setCurrentlyAnalyzingId(image.id);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 300 second timeout (5 minutes)

    try {
      const res = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: image.id,
          fileName: image.name,
          folderId: folderId,
          mimeType: image.mimeType
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const result = await res.json();
      
      if (result.error) {
        let errorMessage = result.error;
        if (typeof result.error === 'object' && result.error.code === 503) {
          errorMessage = "ระบบวิเคราะห์ภาพ (Gemini) กำลังทำงานหนักในขณะนี้ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (Error 503)";
        } else if (typeof result.error === 'string' && result.error.includes("503")) {
          errorMessage = "ระบบวิเคราะห์ภาพ (Gemini) กำลังทำงานหนักในขณะนี้ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (Error 503)";
        }
        if (!silent) alert(errorMessage);
        
        // Even if error, mark as analyzed with the error so we don't keep retrying it in batch
        setImagesInFolder(prev => {
          const updated = prev.map(img => img.id === image.id ? { ...img, analysis: result } : img);
          updateAnalysisSummary(updated);
          return updated;
        });
        return result;
      }

      setImagesInFolder(prev => {
        const updated = prev.map(img => img.id === image.id ? { ...img, analysis: result } : img);
        updateAnalysisSummary(updated);
        return updated;
      });
      return result;
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Failed to analyze image:", err);
      const errorResult = { error: err.name === 'AbortError' ? "หมดเวลาการเชื่อมต่อ (Timeout)" : "เกิดข้อผิดพลาดในการเชื่อมต่อ" };
      
      setImagesInFolder(prev => {
        const updated = prev.map(img => img.id === image.id ? { ...img, analysis: errorResult } : img);
        updateAnalysisSummary(updated);
        return updated;
      });
      
      if (!silent) alert(errorResult.error);
      return errorResult;
    } finally {
      setCurrentlyAnalyzingId(null);
    }
  };

  const handleBatchAnalyze = async (folderId: string) => {
    setIsBatchAnalyzing(true);
    stopBatchRef.current = false;
    const toAnalyze = imagesInFolder.filter(img => !img.analysis || img.analysis.error);
    setBatchProgress({ current: 0, total: toAnalyze.length });
    
    let count = 0;
    for (const img of toAnalyze) {
      if (stopBatchRef.current) break;
      count++;
      setBatchProgress(prev => ({ ...prev, current: count }));
      try {
        await handleAnalyzeImage(img, folderId, true);
        // Wait 2 seconds between images to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error("Batch analysis error for image:", img.name, err);
      }
    }
    
    setIsBatchAnalyzing(false);
    setBatchProgress({ current: 0, total: 0 });
    stopBatchRef.current = false;
    // Refresh health index logs after batch
    fetchHealthIndex();
  };

  const months = [
    { value: 0, label: 'มกราคม' },
    { value: 1, label: 'กุมภาพันธ์' },
    { value: 2, label: 'มีนาคม' },
    { value: 3, label: 'เมษายน' },
    { value: 4, label: 'พฤษภาคม' },
    { value: 5, label: 'มิถุนายน' },
    { value: 6, label: 'กรกฎาคม' },
    { value: 7, label: 'สิงหาคม' },
    { value: 8, label: 'กันยายน' },
    { value: 9, label: 'ตุลาคม' },
    { value: 10, label: 'พฤศจิกายน' },
    { value: 11, label: 'ธันวาคม' },
  ];

  // Show years from 2567 (2024) to 2575 (2032)
  const years = Array.from({ length: 9 }, (_, i) => 2024 + i);

  const fetchHealthIndex = () => {
    fetch(`/api/health-index?month=${selectedMonth + 1}&year=${selectedYear}`)
      .then(res => res.json())
      .then(data => setHealthIndex(data));
  };

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard-stats?month=${selectedMonth + 1}&year=${selectedYear}`)
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      });
    fetchHealthIndex();
  }, [selectedMonth, selectedYear]);

  const handleAnalyze = async (substationName: string, force = false) => {
    setAnalyzing(substationName);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes
    
    try {
      const res = await fetch('/api/analyze-substation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ substationName, month: selectedMonth + 1, year: selectedYear, force }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      console.log("Analysis result:", data);
      if (data.error) {
        let errorMessage = data.error;
        if (typeof data.error === 'object' && data.error.code === 503) {
          errorMessage = "ระบบวิเคราะห์ภาพ (Gemini) กำลังทำงานหนักในขณะนี้ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (Error 503)";
        } else if (typeof data.error === 'string' && data.error.includes("503")) {
          errorMessage = "ระบบวิเคราะห์ภาพ (Gemini) กำลังทำงานหนักในขณะนี้ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (Error 503)";
        }
        alert(errorMessage);
      } else {
        if (data.summary) {
          alert(data.summary);
        }
        fetchHealthIndex();
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        alert("การวิเคราะห์ใช้เวลานานเกินไป (เกิน 10 นาที) กรุณาตรวจสอบผลลัพธ์ในภายหลัง หรือใช้วิธีวิเคราะห์ทีละภาพ");
      } else {
        console.error(err);
        alert("เกิดข้อผิดพลาดในการวิเคราะห์");
      }
    } finally {
      setAnalyzing(null);
    }
  };

  const handleModalAutoEvaluate = async (substationName: string) => {
    setIsRerunningAI(true);
    try {
      const res = await fetch('/api/analyze-substation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ substationName, month: selectedMonth + 1, year: selectedYear, force: true })
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setSelectedSubForAudit({
          substation_name: substationName,
          battery_score: data.battery_score !== undefined ? data.battery_score : 100,
          battery_na: !!data.battery_na,
          yard_score: data.yard_score !== undefined ? data.yard_score : 100,
          yard_na: !!data.yard_na,
          checklist_score: data.checklist_score !== undefined ? data.checklist_score : 100,
          checklist_na: !!data.checklist_na,
          roof_score: data.roof_score !== undefined ? data.roof_score : 100,
          roof_na: !!data.roof_na,
          fence_score: data.fence_score !== undefined ? data.fence_score : 100,
          fence_na: !!data.fence_na,
          security_score: data.security_score !== undefined ? data.security_score : 100,
          security_na: !!data.security_na,
          summary: data.summary || '',
          status: data.status || 'Green'
        });
        fetchHealthIndex();
      }
    } catch (err) {
      console.error(err);
      alert("ไม่สามารถติดต่อเซิร์ฟเวอร์เพื่อวิเคราะห์ด้วย AI ได้");
    } finally {
      setIsRerunningAI(false);
    }
  };

  const handleSaveAudit = async (auditData: any) => {
    setIsSavingAudit(true);
    try {
      const response = await fetch('/api/save-health-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          substationName: auditData.substation_name,
          month: selectedMonth + 1,
          year: selectedYear,
          battery_score: auditData.battery_score,
          battery_na: auditData.battery_na,
          yard_score: auditData.yard_score,
          yard_na: auditData.yard_na,
          checklist_score: auditData.checklist_score,
          checklist_na: auditData.checklist_na,
          roof_score: auditData.roof_score,
          roof_na: auditData.roof_na,
          fence_score: auditData.fence_score,
          fence_na: auditData.fence_na,
          security_score: auditData.security_score,
          security_na: auditData.security_na,
          summary: auditData.summary,
          status: auditData.status
        })
      });
      const res = await response.json();
      if (res.success) {
        // Refresh the local healthIndex from DB!
        fetchHealthIndex();
        setSelectedSubForAudit(null);
      } else {
        alert("ไม่สามารถบันทึกได้: " + (res.error || "ข้อผิดพลาดที่ไม่รู้จัก"));
      }
    } catch (err: any) {
      console.error(err);
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    } finally {
      setIsSavingAudit(false);
    }
  };

  const calculateHIForSubstation = (healthRow: any) => {
    if (!healthRow) return { score: 100, isEvaluated: false, naCount: 0, grade: 'ดีมาก', gradeColor: 'text-emerald-600 bg-emerald-50 border-emerald-100' };

    let totalWeightApplicable = 0;
    let totalScoreWeight = 0;

    const categories = [
      { score: healthRow.battery_score, na: healthRow.battery_na, weight: 0.25 },
      { score: healthRow.yard_score, na: healthRow.yard_na, weight: 0.20 },
      { score: healthRow.checklist_score, na: healthRow.checklist_na, weight: 0.15 },
      { score: healthRow.roof_score, na: healthRow.roof_na, weight: 0.15 },
      { score: healthRow.fence_score, na: healthRow.fence_na, weight: 0.15 },
      { score: healthRow.security_score, na: healthRow.security_na, weight: 0.10 }
    ];

    let naCount = 0;
    categories.forEach(cat => {
      const isNa = cat.na === true;
      const scoreVal = cat.score !== undefined && cat.score !== null ? cat.score : 100;

      if (!isNa) {
        totalWeightApplicable += cat.weight;
        totalScoreWeight += (scoreVal * cat.weight);
      } else {
        naCount++;
      }
    });

    if (totalWeightApplicable === 0) {
      return { score: 0, isEvaluated: true, naCount, grade: 'ต้องปรับปรุง', gradeColor: 'text-rose-600 bg-rose-50 border-rose-100' };
    }

    const score = Math.round((totalScoreWeight / totalWeightApplicable) * 10) / 10;
    
    let grade = 'ต้องปรับปรุง';
    let gradeColor = 'text-rose-600 bg-rose-50 border-rose-100';
    if (score >= 90) {
      grade = 'ดีมาก';
      gradeColor = 'text-emerald-600 bg-emerald-50 border-emerald-100';
    } else if (score >= 80) {
      grade = 'ดี';
      gradeColor = 'text-teal-600 bg-teal-50 border-teal-100';
    } else if (score >= 70) {
      grade = 'ปานกลาง';
      gradeColor = 'text-amber-600 bg-amber-50 border-amber-100';
    }

    return { score, isEvaluated: true, naCount, grade, gradeColor };
  };

  const REQUIRED_CATEGORIES = ['fence', 'battery', 'checklist'];

  const substationCompletionMap = new Map<string, Set<string>>();
  stats.recent.forEach(log => {
    const name = (log.substation_name || "").trim();
    if (!substationCompletionMap.has(name)) {
      substationCompletionMap.set(name, new Set());
    }
    (log.categories || []).forEach(cat => {
      if (REQUIRED_CATEGORIES.includes(cat)) {
        substationCompletionMap.get(name)?.add(cat);
      }
    });
  });

  const pendingSubstations = SUBSTATIONS.filter(sub => {
    const name = (sub.name || "").trim();
    const cats = substationCompletionMap.get(name);
    return !cats || cats.size < REQUIRED_CATEGORIES.length;
  });

  const inspectedSubstations = SUBSTATIONS.filter(sub => {
    const name = (sub.name || "").trim();
    const cats = substationCompletionMap.get(name);
    return cats && cats.size >= REQUIRED_CATEGORIES.length;
  }).map(sub => {
    // Find the latest inspection for this sub
    const latestLog = stats.recent.find(log => (log.substation_name || "").trim() === (sub.name || "").trim());
    return { ...sub, latestLog };
  });

  return (
    <div className="min-h-screen bg-violet-50 p-6 relative">
      {loading && (
        <div className="absolute inset-0 bg-white/50 backdrop-blur-[2px] z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-violet-600" size={40} />
            <p className="text-sm font-bold text-violet-600">...กำลังโหลดข้อมูล...</p>
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 -ml-2 text-slate-400 hover:text-slate-900">
              <ChevronRight size={24} className="rotate-180" />
            </button>
            <h2 className="text-2xl font-bold text-slate-900">Executive Dashboard</h2>
          </div>

          <div className="flex bg-slate-200 p-1 rounded-xl">
              <button 
                onClick={() => setActiveTab('progress')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                  activeTab === 'progress' ? "bg-white text-violet-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                ความคืบหน้า
              </button>
              <button 
                onClick={() => setActiveTab('health')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                  activeTab === 'health' ? "bg-white text-violet-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Health Index
              </button>
            </div>

          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">เลือกเดือนที่ต้องการตรวจสอบ</span>
            <div className="flex gap-2">
              <select 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-violet-500"
              >
                {months.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <select 
                value={selectedYear} 
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-violet-500"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y + 543}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {activeTab === 'progress' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div key="total" className="cursor-pointer" onClick={() => setShowInspectedModal(true)}>
            <Card className="bg-violet-600 text-white border-none shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all group">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-violet-100 text-xs font-bold uppercase tracking-wider mb-1">ตรวจสอบแล้ว ({months[selectedMonth].label})</p>
                  <h3 className="text-4xl font-bold">{inspectedSubstations.length} <span className="text-lg font-normal opacity-70">สถานี</span></h3>
                  <p className="text-[10px] text-violet-100 mt-1 font-bold">รวม {stats.totalSubmissions} รายการส่ง</p>
                </div>
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 group-hover:bg-white/20 group-hover:text-white transition-colors">
                  <ChevronRight size={18} />
                </div>
              </div>
              <p className="text-[10px] text-violet-200 mt-1 font-bold opacity-0 group-hover:opacity-100 transition-opacity">คลิกเพื่อดูรายชื่อ</p>
            </Card>
          </div>
          <div key="pending" className="cursor-pointer" onClick={() => setShowPendingModal(true)}>
            <Card className="hover:border-violet-300 hover:shadow-md transition-all group">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">รอดำเนินการ</p>
                  <h3 className="text-4xl font-bold text-slate-800">{pendingSubstations.length} <span className="text-lg font-normal opacity-40">สถานี</span></h3>
                </div>
                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-violet-50 group-hover:text-violet-500 transition-colors">
                  <ChevronRight size={18} />
                </div>
              </div>
              <p className="text-[10px] text-violet-600 mt-1 font-bold opacity-0 group-hover:opacity-100 transition-opacity">คลิกเพื่อดูรายชื่อ</p>
            </Card>
          </div>
          <div key="coverage">
            <Card>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">ความครอบคลุม</p>
              <h3 className="text-4xl font-bold text-slate-800">
                {((inspectedSubstations.length / SUBSTATIONS.length) * 100).toFixed(1)}%
              </h3>
              <p className="text-[10px] text-slate-400 mt-1 font-bold">จากทั้งหมด {SUBSTATIONS.length} สถานี</p>
            </Card>
          </div>
        </div>

        {/* Substation Progress Summary */}
        <Card className="mb-8 p-0 overflow-hidden">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <h4 className="font-bold text-slate-800 uppercase tracking-wider text-sm">สรุปความคืบหน้ารายสถานี</h4>
            <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase">เดือน{months[selectedMonth].label} {selectedYear + 543}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                  <th className="px-6 py-3">สถานีไฟฟ้า</th>
                  <th className="px-6 py-3">ความคืบหน้า</th>
                  <th className="px-6 py-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {SUBSTATIONS.map(sub => {
                  const name = (sub.name || "").trim();
                  const cats = substationCompletionMap.get(name) || new Set();
                  const progress = cats.size;
                  const isDone = progress >= REQUIRED_CATEGORIES.length;
                  
                  // Only show stations that have at least one log in the current month
                  if (progress === 0 && !stats.recent.some(l => (l.substation_name || "").trim() === name)) return null;

                  return (
                    <tr key={sub.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800 text-sm">{sub.name}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden min-w-[100px]">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${(progress / REQUIRED_CATEGORIES.length) * 100}%` }}
                              className={cn(
                                "h-full rounded-full",
                                isDone ? "bg-emerald-500" : "bg-violet-500"
                              )}
                            />
                          </div>
                          <span className="text-xs font-bold text-slate-500">{progress}/{REQUIRED_CATEGORIES.length}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-1 rounded-full uppercase",
                          isDone ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                        )}>
                          {isDone ? "เรียบร้อย" : "กำลังดำเนินการ"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {SUBSTATIONS.every(sub => {
                  const name = (sub.name || "").trim();
                  return !substationCompletionMap.has(name) && !stats.recent.some(l => (l.substation_name || "").trim() === name);
                }) && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-slate-400 italic text-sm">
                      ยังไม่มีข้อมูลการตรวจสอบในเดือนนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="p-6 border-bottom border-slate-100 flex justify-between items-center">
            <h4 className="font-bold text-slate-800">ประวัติการตรวจสอบ ({months[selectedMonth].label} {selectedYear + 543})</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                  <th className="px-6 py-4">สถานีไฟฟ้า</th>
                  <th className="px-6 py-4">ผู้ปฏิบัติงาน</th>
                  <th className="px-6 py-4">วัน-เวลา</th>
                  <th className="px-6 py-4">สถานะ</th>
                  <th className="px-6 py-4">หลักฐาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.recent.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-800">{log.substation_name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-mono">{log.employee_id}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {format(new Date(log.timestamp), 'dd/MM/yy HH:mm', { locale: th })}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 rounded-full",
                            REQUIRED_CATEGORIES.every(cat => log.categories?.includes(cat))
                              ? "bg-emerald-50 text-emerald-600" 
                              : "bg-amber-50 text-amber-600"
                          )}>
                            <CheckCircle2 size={12} /> {REQUIRED_CATEGORIES.every(cat => log.categories?.includes(cat)) ? 'เรียบร้อย' : 'กำลังดำเนินการ'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">
                            ({REQUIRED_CATEGORIES.filter(cat => log.categories?.includes(cat)).length}/{REQUIRED_CATEGORIES.length})
                          </span>
                        </div>
                        {log.categories && !REQUIRED_CATEGORIES.every(cat => log.categories.includes(cat)) && (
                          <div className="flex flex-wrap gap-1 max-w-[150px]">
                            {REQUIRED_CATEGORIES.filter(cat => !log.categories.includes(cat)).map(cat => (
                              <span key={cat} className="text-[7px] text-slate-400 bg-slate-100 px-1 rounded">
                                {CATEGORY_LABELS[cat] || cat}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <a 
                        href={`https://drive.google.com/drive/folders/${log.folder_id}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-violet-600 hover:text-violet-700"
                      >
                        <ImageIcon size={18} />
                      </a>
                    </td>
                  </tr>
                ))}
                {stats.recent.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                      ยังไม่มีข้อมูลการตรวจสอบในเดือนนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
          </>
        ) : (() => {
          const evaluatedRows = SUBSTATIONS.map(sub => {
            const row = healthIndex.find(h => h.substation_name === sub.name);
            return { sub, row, calculation: calculateHIForSubstation(row) };
          });
          
          const auditedRows = evaluatedRows.filter(item => item.row !== undefined);
          const totalAudited = auditedRows.length;
          const averageHI = totalAudited > 0 
            ? Math.round((auditedRows.reduce((acc, curr) => acc + curr.calculation.score, 0) / totalAudited) * 10) / 10 
            : 0;
          
          const countExcellent = evaluatedRows.filter(r => r.row && r.calculation.score >= 90).length;
          const countGood = evaluatedRows.filter(r => r.row && r.calculation.score >= 80 && r.calculation.score < 90).length;
          const countFair = evaluatedRows.filter(r => r.row && r.calculation.score >= 70 && r.calculation.score < 80).length;
          const countPoor = evaluatedRows.filter(r => r.row && r.calculation.score < 70).length;
          const unAuditedCount = SUBSTATIONS.length - totalAudited;

          return (
            <div className="space-y-6">
              {/* KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Average Health Index Speedometer/Card */}
                <Card className="bg-slate-900 text-white border-none shadow-xl flex flex-col justify-between p-4 col-span-1 sm:col-span-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ดัชนีสุขภาพเฉลี่ย (Average HI)</span>
                      <h3 className="text-4xl font-extrabold mt-1 text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-400">
                        {totalAudited > 0 ? `${averageHI}%` : 'N/A'}
                      </h3>
                    </div>
                    <div className="p-2 bg-slate-800 rounded-xl text-teal-400">
                      <Sliders size={20} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all duration-500" 
                        style={{ width: `${totalAudited > 0 ? averageHI : 0}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2 font-medium">
                      ประเมินแล้ว: <span className="text-white font-bold">{totalAudited}</span> จาก {SUBSTATIONS.length} สถานี ทั้งหมด ({months[selectedMonth].label})
                    </p>
                  </div>
                </Card>

                {/* Excellent Rating Card */}
                <button 
                  onClick={() => setActiveGradeFilter(activeGradeFilter === 'Excellent' ? null : 'Excellent')}
                  className={cn(
                    "text-left p-4 rounded-2xl border transition-all flex flex-col justify-between cursor-pointer",
                    activeGradeFilter === 'Excellent' 
                      ? "bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-100" 
                      : "bg-white text-slate-800 border-slate-100 hover:border-slate-200"
                  )}
                >
                  <div>
                    <span className={cn("text-[9px] font-bold uppercase tracking-wider", activeGradeFilter === 'Excellent' ? "text-emerald-100" : "text-slate-400")}>
                      ดีมาก (≥ 90%)
                    </span>
                    <h4 className="text-2xl font-extrabold mt-1">{countExcellent}</h4>
                  </div>
                  <span className={cn("text-[9px] font-bold block mt-3", activeGradeFilter === 'Excellent' ? "text-emerald-100" : "text-slate-400")}>
                    {activeGradeFilter === 'Excellent' ? '• กำลังกรองข้อมูล' : 'คลิกเพื่อกรอง'}
                  </span>
                </button>

                {/* Good Rating Card */}
                <button 
                  onClick={() => setActiveGradeFilter(activeGradeFilter === 'Good' ? null : 'Good')}
                  className={cn(
                    "text-left p-4 rounded-2xl border transition-all flex flex-col justify-between cursor-pointer",
                    activeGradeFilter === 'Good' 
                      ? "bg-teal-500 text-white border-teal-500 shadow-lg shadow-teal-100" 
                      : "bg-white text-slate-800 border-slate-100 hover:border-slate-200"
                  )}
                >
                  <div>
                    <span className={cn("text-[9px] font-bold uppercase tracking-wider", activeGradeFilter === 'Good' ? "text-teal-100" : "text-slate-400")}>
                      ดี (80% - 89%)
                    </span>
                    <h4 className="text-2xl font-extrabold mt-1">{countGood}</h4>
                  </div>
                  <span className={cn("text-[9px] font-bold block mt-3", activeGradeFilter === 'Good' ? "text-teal-100" : "text-slate-400")}>
                    {activeGradeFilter === 'Good' ? '• กำลังกรองข้อมูล' : 'คลิกเพื่อกรอง'}
                  </span>
                </button>

                {/* Fair Rating Card */}
                <button 
                  onClick={() => setActiveGradeFilter(activeGradeFilter === 'Fair' ? null : 'Fair')}
                  className={cn(
                    "text-left p-4 rounded-2xl border transition-all flex flex-col justify-between cursor-pointer",
                    activeGradeFilter === 'Fair' 
                      ? "bg-amber-50 text-amber-700 border-amber-300 shadow-lg shadow-amber-100" 
                      : "bg-white text-slate-800 border-slate-100 hover:border-slate-200"
                  )}
                >
                  <div>
                    <span className={cn("text-[9px] font-bold uppercase tracking-wider", activeGradeFilter === 'Fair' ? "text-amber-800/80" : "text-slate-400")}>
                      ปานกลาง (70% - 79%)
                    </span>
                    <h4 className="text-2xl font-extrabold mt-1 text-amber-700">{countFair}</h4>
                  </div>
                  <span className={cn("text-[9px] font-bold block mt-3", activeGradeFilter === 'Fair' ? "text-amber-800/80" : "text-slate-400")}>
                    {activeGradeFilter === 'Fair' ? '• กำลังกรองข้อมูล' : 'คลิกเพื่อกรอง'}
                  </span>
                </button>

                {/* Need Improvement Card */}
                <button 
                  onClick={() => setActiveGradeFilter(activeGradeFilter === 'Poor' ? null : 'Poor')}
                  className={cn(
                    "text-left p-4 rounded-2xl border transition-all flex flex-col justify-between cursor-pointer",
                    activeGradeFilter === 'Poor' 
                      ? "bg-rose-500 text-white border-rose-500 shadow-lg shadow-rose-100" 
                      : "bg-white text-slate-800 border-slate-100 hover:border-slate-200"
                  )}
                >
                  <div>
                    <span className={cn("text-[9px] font-bold uppercase tracking-wider", activeGradeFilter === 'Poor' ? "text-rose-100" : "text-slate-400")}>
                      ต้องปรับปรุง (&lt; 70%)
                    </span>
                    <h4 className="text-2xl font-extrabold mt-1">{countPoor}</h4>
                  </div>
                  <span className={cn("text-[9px] font-bold block mt-3", activeGradeFilter === 'Poor' ? "text-rose-100" : "text-slate-400")}>
                    {activeGradeFilter === 'Poor' ? '• กำลังกรองข้อมูล' : 'คลิกเพื่อกรอง'}
                  </span>
                </button>
              </div>

              {/* Formula & Explanation Card */}
              <Card className="bg-slate-50 border-slate-250 p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-violet-100 text-violet-600 rounded-xl mt-0.5">
                    <Info size={16} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-slate-800">สูตรคำนวณดัชนีสุขภาพปรับตามระดับอุปกรณ์จริง (Dynamic Weighting and Normalization)</h4>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      หากสถานีใดไม่มีอุปกรณ์ประเภทใด (เช่น ชานดาดฟ้า หรือทีม รปภ. ประจำการ) ให้ตั้งค่าอุปกรณ์ชิ้นนั้นเป็น <strong>N/A</strong> 
                      ระบบจะทำการปรับฐานน้ำหนักคะแนนรวมเทียบเปรียบเฉลี่ยใหม่ตามสูตรประเมินเพื่อให้แน่ใจว่าไม่มีการหักคะแนนส่วนที่ขาดตกบกพร่องตามจริงอย่างยุติธรรม:
                    </p>
                    <p className="text-[11px] font-bold font-mono text-violet-700 bg-white border border-slate-200 p-2 rounded-lg inline-block mt-2">
                      ดัชนีสุขภาพ (HI %): (Σ (คะแนนส่วนประกอบ × น้ำหนักสัดส่วน) / Σ (น้ำหนักที่ใช้งานจริง)) × 100
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 mt-2 pt-1 border-t border-slate-200/40">
                      <div className="text-[9px] text-slate-500"><strong className="text-slate-700">🔋 แบตเตอรี่:</strong> 25%</div>
                      <div className="text-[9px] text-slate-500"><strong className="text-slate-700">⚡ ลานไก:</strong> 20%</div>
                      <div className="text-[9px] text-slate-500"><strong className="text-slate-700">📝 Checklist:</strong> 15%</div>
                      <div className="text-[9px] text-slate-500"><strong className="text-slate-700">🏢 ดาดฟ้า:</strong> 15%</div>
                      <div className="text-[9px] text-slate-500"><strong className="text-slate-700">🚧 รั้วรอบ:</strong> 15%</div>
                      <div className="text-[9px] text-slate-500"><strong className="text-slate-700">👮 รปภ.:</strong> 10%</div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Substation Search & Grade Filters Info */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="ค้นหาชื่อสถานีไฟฟ้า..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-500 shadow-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {activeGradeFilter && (
                    <button 
                      onClick={() => setActiveGradeFilter(null)}
                      className="text-[10px] bg-slate-100 text-slate-500 px-3 py-1.5 rounded-xl font-bold hover:bg-slate-200 transition-colors cursor-pointer"
                    >
                      ล้างตัวกรอง ({activeGradeFilter === 'Excellent' ? 'ดีมาก' : activeGradeFilter === 'Good' ? 'ดี' : activeGradeFilter === 'Fair' ? 'ปานกลาง' : 'ต้องปรับปรุง'}) ✕
                    </button>
                  )}
                  <span className="text-[10px] text-slate-400 font-bold">
                    แสดงผล {
                      SUBSTATIONS.filter(sub => {
                        const matchesSearch = sub.name.toLowerCase().includes(searchQuery.toLowerCase());
                        if (!matchesSearch) return false;
                        if (!activeGradeFilter) return true;
                        const r = healthIndex.find(h => h.substation_name === sub.name);
                        const cal = calculateHIForSubstation(r);
                        if (activeGradeFilter === 'Excellent') return cal.score >= 90;
                        if (activeGradeFilter === 'Good') return cal.score >= 80 && cal.score < 90;
                        if (activeGradeFilter === 'Fair') return cal.score >= 70 && cal.score < 80;
                        if (activeGradeFilter === 'Poor') return cal.score < 70;
                        return true;
                      }).length
                    } จาก {SUBSTATIONS.length} สถานี
                  </span>
                </div>
              </div>

              {/* List of Substations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SUBSTATIONS.filter(sub => {
                  const matchesSearch = sub.name.toLowerCase().includes(searchQuery.toLowerCase());
                  if (!matchesSearch) return false;
                  
                  if (!activeGradeFilter) return true;
                  const r = healthIndex.find(h => h.substation_name === sub.name);
                  const cal = calculateHIForSubstation(r);
                  if (activeGradeFilter === 'Excellent') return cal.score >= 90;
                  if (activeGradeFilter === 'Good') return cal.score >= 80 && cal.score < 90;
                  if (activeGradeFilter === 'Fair') return cal.score >= 70 && cal.score < 80;
                  if (activeGradeFilter === 'Poor') return cal.score < 70;
                  return true;
                }).map(sub => {
                  const healthRow = healthIndex.find(h => h.substation_name === sub.name);
                  const cal = calculateHIForSubstation(healthRow);
                  const isAnalyzing = analyzing === sub.name;

                  return (
                    <Card key={sub.id} className="relative overflow-hidden hover:shadow-md transition-all border border-slate-100 bg-white p-5 flex flex-col justify-between">
                      <div className={cn("absolute left-0 top-0 bottom-0 w-1.5", 
                        !healthRow ? "bg-slate-300" :
                        cal.score >= 90 ? "bg-emerald-500" :
                        cal.score >= 80 ? "bg-teal-500" :
                        cal.score >= 70 ? "bg-amber-500" : "bg-rose-500"
                      )} />
                      
                      <div className="pl-3 space-y-3">
                        {/* Substation Header */}
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <h4 className="font-bold text-slate-800 text-sm">{sub.name}</h4>
                            <span className="text-[9px] text-slate-400 font-bold block mt-0.5">สถานีประธานเขตไฟฟ้าแรงสูง</span>
                          </div>
                          {healthRow ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full border", cal.gradeColor)}>
                                {cal.grade}
                              </span>
                              <span className="text-xs font-mono font-extrabold text-slate-800">
                                {cal.score}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200">
                              ยังไม่ได้ประเมิน
                            </span>
                          )}
                        </div>

                        {/* Six Categories Breakdown Visualizer */}
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/40 grid grid-cols-3 gap-y-2 gap-x-1">
                          {[
                            { name: '🔋 แบตเตอรี่', score: healthRow?.battery_score, na: healthRow?.battery_na },
                            { name: '⚡ ลานไก', score: healthRow?.yard_score, na: healthRow?.yard_na },
                            { name: '📝 Checklist', score: healthRow?.checklist_score, na: healthRow?.checklist_na },
                            { name: '🏢 ดาดฟ้า', score: healthRow?.roof_score, na: healthRow?.roof_na },
                            { name: '🚧 รั้วรอบ', score: healthRow?.fence_score, na: healthRow?.fence_na },
                            { name: '👮 รปภ.', score: healthRow?.security_score, na: healthRow?.security_na }
                          ].map((item, idx) => (
                            <div key={idx} className="flex flex-col">
                              <span className="text-[8px] text-slate-400 font-semibold truncate">{item.name}</span>
                              <span className={cn("text-[10px] font-bold mt-0.5 font-mono",
                                item.na ? "text-slate-300" :
                                (item.score ?? 100) >= 90 ? "text-emerald-600" :
                                (item.score ?? 100) >= 70 ? "text-amber-500" : "text-rose-500"
                              )}>
                                {item.na ? 'N/A' : `${item.score ?? 100}%`}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Audit Findings and Date Analysis */}
                        {healthRow ? (
                          <div className="space-y-1">
                            <p className="text-[10px] text-slate-500 bg-violet-50/40 p-2 rounded-lg border border-violet-100/30 italic">
                              "{healthRow.summary || 'ประเมินดัชนีสุขภาพปกติ ไร้วัชพืชและเศษขยะบนดาดฟ้า'}"
                            </p>
                            <div className="flex justify-between items-center text-[8px] text-slate-400">
                              <span>ผู้ตรวจ: ฝ่ายวิศวกรรมไฟฟ้า</span>
                              <span>ปรับปรุงเมื่อ: {format(new Date(healthRow.analyzed_at), 'dd MMM yy HH:mm', { locale: th })}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="py-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center">
                            <p className="text-[9px] text-slate-400 italic">เกณฑ์ปกติคงค้างประเมิน กด "ประเมินผล" เพื่อเริ่มทำรายการ</p>
                          </div>
                        )}

                        {/* Buttons Grid */}
                        <div className="grid grid-cols-3 gap-1.5 mt-2">
                          <Button 
                            onClick={() => {
                              setSelectedSubForAudit({
                                substation_name: sub.name,
                                battery_score: healthRow?.battery_score ?? 100,
                                battery_na: healthRow?.battery_na ?? false,
                                yard_score: healthRow?.yard_score ?? 100,
                                yard_na: healthRow?.yard_na ?? false,
                                checklist_score: healthRow?.checklist_score ?? 100,
                                checklist_na: healthRow?.checklist_na ?? false,
                                roof_score: healthRow?.roof_score ?? 100,
                                roof_na: healthRow?.roof_na ?? false,
                                fence_score: healthRow?.fence_score ?? 100,
                                fence_na: healthRow?.fence_na ?? false,
                                security_score: healthRow?.security_score ?? 100,
                                security_na: healthRow?.security_na ?? false,
                                summary: healthRow?.summary ?? '',
                                status: healthRow?.status ?? 'Green'
                              });
                            }} 
                            className="py-1.5 text-[10px] font-bold bg-violet-600 hover:bg-violet-700 inline-flex items-center justify-center gap-1 cursor-pointer"
                          >
                            ประเมินผล
                          </Button>

                          <Button 
                            onClick={() => handleAnalyze(sub.name, !!healthRow)} 
                            disabled={isAnalyzing}
                            className="py-1.5 text-[10px] font-bold inline-flex items-center justify-center gap-0.5 cursor-pointer"
                            variant="outline"
                          >
                            {isAnalyzing ? (
                              <><Loader2 className="animate-spin w-3 h-3" /> รอดำเนินการ</>
                            ) : (
                              <>วิเคราะห์ AI</>
                            )}
                          </Button>

                          <Button 
                            onClick={async () => {
                              setSelectedSubstationForAnalysis(sub.name);
                              setImagesInFolder([]);
                              try {
                                const res = await fetch(`/api/analyze-substation`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ substationName: sub.name, month: selectedMonth + 1, year: selectedYear, dryRun: true })
                                });
                                const data = await res.json();
                                if (data.folderId) {
                                  fetchImagesInFolder(data.folderId);
                                }
                              } catch (err) {
                                console.error(err);
                              }
                            }}
                            className="py-1.5 text-[10px] font-bold cursor-pointer"
                            variant="outline"
                          >
                            รูปภาพ
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })()}

      </div>

      {/* Image Analysis Detail Modal */}
      <AnimatePresence>
        {selectedSubstationForAnalysis && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedSubstationForAnalysis(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-5xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">รายละเอียดการวิเคราะห์: {selectedSubstationForAnalysis}</h3>
                  <p className="text-xs font-bold text-violet-600 uppercase tracking-wider">
                    ประจำเดือน {months[selectedMonth].label} {selectedYear + 543}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {isBatchAnalyzing && (
                    <div className="hidden md:flex flex-col items-end mr-2">
                      <span className="text-[10px] font-bold text-violet-600">กำลังวิเคราะห์...</span>
                      <span className="text-[10px] text-slate-400">{batchProgress.current} / {batchProgress.total} ภาพ</span>
                    </div>
                  )}
                  {isBatchAnalyzing ? (
                    <Button 
                      onClick={() => stopBatchRef.current = true}
                      variant="destructive"
                      className="hidden md:flex gap-2"
                    >
                      <Loader2 className="animate-spin w-3 h-3" /> หยุดการวิเคราะห์
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => selectedFolderId && handleBatchAnalyze(selectedFolderId)}
                      disabled={imagesInFolder.length === 0 || !selectedFolderId}
                      className="hidden md:flex"
                    >
                      <LayoutDashboard size={14} /> วิเคราะห์ภาพที่เหลือ
                    </Button>
                  )}
                  <button 
                    onClick={() => {
                      setSelectedSubstationForAnalysis(null);
                      setSelectedFolderId(null);
                    }}
                    className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
                  >
                    <Plus size={24} className="rotate-45" />
                  </button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                {/* Summary Dashboard */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                  <Card className="p-4 text-center">
                    <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">รูปภาพทั้งหมด</p>
                    <h4 className="text-2xl font-bold text-slate-800">{analysisSummary.total}</h4>
                  </Card>
                  <Card className="p-4 text-center border-emerald-100 bg-emerald-50/30">
                    <p className="text-[10px] text-emerald-600 font-bold uppercase mb-1">สะอาดปกติ</p>
                    <h4 className="text-2xl font-bold text-emerald-600">{analysisSummary.clean}</h4>
                  </Card>
                  <Card className="p-4 text-center border-rose-100 bg-rose-50/30">
                    <p className="text-[10px] text-rose-600 font-bold uppercase mb-1">พบปัญหา</p>
                    <h4 className="text-2xl font-bold text-rose-600">{analysisSummary.issues}</h4>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-[10px] text-amber-600 font-bold uppercase mb-1">หญ้า (Weed)</p>
                    <h4 className="text-2xl font-bold text-amber-600">{analysisSummary.weeds}</h4>
                  </Card>
                  <Card className="p-4 text-center">
                    <p className="text-[10px] text-violet-600 font-bold uppercase mb-1">ขี้นก (Bird)</p>
                    <h4 className="text-2xl font-bold text-violet-600">{analysisSummary.birdDroppings}</h4>
                  </Card>
                </div>

                {isFetchingImages ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <Loader2 className="animate-spin text-violet-600 w-10 h-10" />
                    <p className="text-slate-400 italic">กำลังดึงข้อมูลรูปภาพจาก Google Drive...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {imagesInFolder.map(img => (
                      <div key={img.id} className="group relative bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm hover:shadow-md transition-all">
                        <div className="aspect-square bg-slate-100 relative">
                          {img.thumbnailLink ? (
                            <img 
                              src={img.thumbnailLink.replace('=s220', '=s400')} 
                              alt={img.name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-300">
                              <ImageIcon size={32} />
                            </div>
                          )}
                          
                          {/* Status Badge */}
                          <div className="absolute top-2 right-2">
                            {currentlyAnalyzingId === img.id ? (
                              <span className="w-6 h-6 rounded-full bg-violet-500 text-white flex items-center justify-center shadow-lg animate-pulse">
                                <Loader2 size={14} className="animate-spin" />
                              </span>
                            ) : img.analysis ? (
                              <span className={cn(
                                "w-6 h-6 rounded-full flex items-center justify-center shadow-lg",
                                img.analysis.error ? "bg-amber-500 text-white" : (img.analysis.status === 'Green' ? "bg-emerald-500 text-white" : "bg-rose-500 text-white")
                              )}>
                                {img.analysis.error ? <AlertCircle size={14} /> : (img.analysis.status === 'Green' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />)}
                              </span>
                            ) : (
                              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-400 flex items-center justify-center shadow-lg">
                                <Clock size={14} />
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div className="p-3 flex flex-col h-full">
                          <p className="text-[10px] font-bold text-slate-800 truncate mb-1" title={img.name}>{img.name}</p>
                          
                          {img.analysis && img.analysis.status !== 'Gray' && (
                            <div className="mb-2 space-y-1.5">
                              <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                                <p className="text-[8px] font-bold text-slate-400 uppercase mb-0.5">Summary</p>
                                <p className="text-[9px] text-slate-600 leading-tight italic">
                                  {img.analysis.summary || "ไม่มีข้อมูลสรุป"}
                                </p>
                              </div>
                              
                              <div className="flex flex-wrap gap-1">
                                {img.analysis.findings && img.analysis.findings.length > 0 ? (
                                  img.analysis.findings.map((f: string) => (
                                    <span key={f} className="text-[8px] bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded font-bold border border-rose-100">
                                      {f === 'Weed' ? 'หญ้า' : (f === 'Bird Droppings' ? 'ขี้นก' : f)}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[8px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-bold border border-emerald-100">
                                    สะอาดปกติ
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {img.analysis && img.analysis.status === 'Gray' && (
                            <div className="mb-2 bg-slate-50 p-1.5 rounded border border-amber-100">
                              <p className="text-[8px] font-bold text-amber-500 uppercase mb-0.5">Error</p>
                              <p className="text-[9px] text-slate-500 leading-tight italic">
                                {img.analysis.summary}
                              </p>
                            </div>
                          )}

                          <Button 
                            onClick={() => selectedFolderId && handleAnalyzeImage(img, selectedFolderId)}
                            disabled={isBatchAnalyzing || currentlyAnalyzingId === img.id}
                            className="w-full py-1.5 text-[9px] h-auto font-bold mt-auto"
                            variant={img.analysis?.status === 'Gray' ? "destructive" : (img.analysis ? "ghost" : "outline")}
                          >
                            {currentlyAnalyzingId === img.id ? (
                              <><Loader2 size={10} className="animate-spin mr-1" /> กำลังวิเคราะห์...</>
                            ) : (img.analysis?.status === 'Gray' ? "ลองใหม่อีกครั้ง" : (img.analysis ? "วิเคราะห์ซ้ำ" : "วิเคราะห์ภาพนี้"))}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Pending Substations Modal */}
      <AnimatePresence>
        {showPendingModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPendingModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">สถานีที่รอดำเนินการ</h3>
                  <p className="text-xs font-bold text-violet-600 uppercase tracking-wider">
                    ประจำเดือน {months[selectedMonth].label} {selectedYear + 543}
                  </p>
                </div>
                <button 
                  onClick={() => setShowPendingModal(false)}
                  className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pendingSubstations.map((sub, idx) => {
                    const covered = substationCompletionMap.get(sub.name) || new Set();
                    const missing = REQUIRED_CATEGORIES.filter(cat => !covered.has(cat));
                    
                    return (
                      <div key={sub.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-3">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs">
                            {(idx + 1).toString().padStart(2, '0')}
                          </div>
                          <div className="flex-1">
                            <h5 className="font-bold text-slate-800 text-sm">{sub.name}</h5>
                            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">
                              {covered.size === 0 ? 'ยังไม่มีการตรวจสอบ' : `ดำเนินการแล้ว ${covered.size}/${REQUIRED_CATEGORIES.length} หัวข้อ`}
                            </p>
                          </div>
                        </div>
                        
                        {missing.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {missing.map(cat => (
                              <span key={cat} className="text-[8px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-500 rounded-md border border-rose-100">
                                {CATEGORY_LABELS[cat] || cat}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {pendingSubstations.length === 0 && (
                  <div className="py-20 text-center">
                    <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 size={40} />
                    </div>
                    <h4 className="text-lg font-bold text-slate-900">ตรวจสอบครบทุกสถานีแล้ว!</h4>
                    <p className="text-sm text-slate-500">ยอดเยี่ยมมาก ทีมงานตรวจสอบครบถ้วน 100%</p>
                  </div>
                )}
              </div>
              
              <div className="p-6 border-t border-slate-100 bg-white sticky bottom-0 z-10">
                <Button onClick={() => setShowPendingModal(false)} className="w-full">
                  ปิดหน้าต่าง
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Inspected Substations Modal */}
      <AnimatePresence>
        {showInspectedModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowInspectedModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">สถานีที่ตรวจสอบแล้ว</h3>
                  <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                    ประจำเดือน {months[selectedMonth].label} {selectedYear + 543}
                  </p>
                </div>
                <button 
                  onClick={() => setShowInspectedModal(false)}
                  className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {inspectedSubstations.map((sub, idx) => (
                    <div key={sub.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold text-xs">
                        {(idx + 1).toString().padStart(2, '0')}
                      </div>
                      <div className="flex-1">
                        <h5 className="font-bold text-slate-800 text-sm">{sub.name}</h5>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">ล่าสุด: {sub.latestLog ? format(new Date(sub.latestLog.timestamp), 'dd/MM/yy HH:mm', { locale: th }) : '-'}</p>
                          <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-tighter flex items-center gap-0.5">
                            <CheckCircle2 size={10} /> ตรวจแล้ว
                          </span>
                        </div>
                      </div>
                      {sub.latestLog && (
                        <a 
                          href={`https://drive.google.com/drive/folders/${sub.latestLog.folder_id}`} 
                          target="_blank" 
                          rel="noreferrer"
                          className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center hover:bg-violet-100 transition-colors"
                        >
                          <ImageIcon size={16} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                {inspectedSubstations.length === 0 && (
                  <div className="py-20 text-center">
                    <div className="w-20 h-20 bg-slate-100 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
                      <ImageIcon size={40} />
                    </div>
                    <h4 className="text-lg font-bold text-slate-900">ยังไม่มีการตรวจสอบ</h4>
                    <p className="text-sm text-slate-500">เริ่มการตรวจสอบสถานีแรกของเดือนได้เลย!</p>
                  </div>
                )}
              </div>
              
              <div className="p-6 border-t border-slate-100 bg-white sticky bottom-0 z-10">
                <Button onClick={() => setShowInspectedModal(false)} className="w-full">
                  ปิดหน้าต่าง
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dynamic Health Index Appraisal Scoring Modal */}
      <AnimatePresence>
        {selectedSubForAudit && (() => {
          const previewSubCal = calculateHIForSubstation(selectedSubForAudit);
          const categoriesDetail = [
            { name: "🔋 แบตเตอรี่", score: selectedSubForAudit.battery_na ? null : (selectedSubForAudit.battery_score ?? 100), weight: 0.25, na: selectedSubForAudit.battery_na },
            { name: "⚡ ลานไก", score: selectedSubForAudit.yard_na ? null : (selectedSubForAudit.yard_score ?? 100), weight: 0.20, na: selectedSubForAudit.yard_na },
            { name: "📝 Checklist", score: selectedSubForAudit.checklist_na ? null : (selectedSubForAudit.checklist_score ?? 100), weight: 0.15, na: selectedSubForAudit.checklist_na },
            { name: "🏢 ดาดฟ้า", score: selectedSubForAudit.roof_na ? null : (selectedSubForAudit.roof_score ?? 100), weight: 0.15, na: selectedSubForAudit.roof_na },
            { name: "🚧 รั้วรอบ", score: selectedSubForAudit.fence_na ? null : (selectedSubForAudit.fence_score ?? 100), weight: 0.15, na: selectedSubForAudit.fence_na },
            { name: "👮 รปภ.", score: selectedSubForAudit.security_na ? null : (selectedSubForAudit.security_score ?? 100), weight: 0.10, na: selectedSubForAudit.security_na }
          ];

          const applicableCats = categoriesDetail.filter(c => !c.na);
          const sumWeights = applicableCats.reduce((acc, c) => acc + c.weight, 0);
          const sumWeightedScores = applicableCats.reduce((acc, c) => acc + ((c.score ?? 100) * c.weight), 0);
          const calculatedHI = sumWeights > 0 ? (sumWeightedScores / sumWeights) : 0;

          return (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 md:p-6 overflow-y-auto">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedSubForAudit(null)}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl flex flex-col my-8 max-h-[90vh] overflow-hidden"
              >
                {/* Header */}
                <div className="p-6 border-b border-slate-150 flex justify-between items-center bg-slate-900 text-white">
                  <div>
                    <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">แผงเกณฑ์ผลคะแนนและสูตรความสมบูรณ์</span>
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <h3 className="text-xl font-bold">{selectedSubForAudit.substation_name}</h3>
                      <button
                        type="button"
                        disabled={isRerunningAI}
                        onClick={() => handleModalAutoEvaluate(selectedSubForAudit.substation_name)}
                        className={`text-[11px] font-extrabold h-7 px-2.5 rounded-lg inline-flex items-center gap-1 cursor-pointer transition-all ${
                          isRerunningAI 
                            ? 'bg-slate-800 text-slate-400 border border-slate-700' 
                            : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold active:scale-95'
                        }`}
                      >
                        {isRerunningAI ? (
                          <>
                            <Loader2 className="animate-spin w-3 h-3" />
                            <span>กำลังประเมินด้วย AI...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-slate-950 fill-slate-950" />
                            <span>สแกนภาพ & ประเมินด้วย AI อัตโนมัติ</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-bold text-slate-300">ดัชนีสุขภาพจำลอง (Preview HI)</span>
                    <span className="text-2xl font-mono font-extrabold text-teal-400">
                      {previewSubCal.score}%
                    </span>
                  </div>
                </div>

                {/* Form fields */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
                  {/* Real-time Math Breakdown Panel */}
                  <div className="bg-slate-900 text-slate-100 p-5 rounded-2xl shadow-inner space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse" />
                        <h4 className="text-xs font-bold uppercase tracking-wider text-teal-400">การคิดคำนวณตามสูตร Dynamic Weighting (เรียลไทม์)</h4>
                      </div>
                      <span className="text-[10px] font-mono bg-slate-800 text-teal-300 px-2 py-0.5 rounded-full font-bold">
                        {applicableCats.length} / 6 หมวดที่ใช้จริง
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-medium">
                      {/* Left: Active values list */}
                      <div className="space-y-1.5 border-r border-slate-800/60 pr-2">
                        <span className="text-[10px] text-slate-400 font-bold block mb-1">ผลประเมินในแต่ละหน่วย:</span>
                        {categoriesDetail.map((c, idx) => (
                          <div key={idx} className="flex justify-between items-center font-mono text-[11px]">
                            <span className="text-slate-300">{c.name}:</span>
                            {c.na ? (
                              <span className="text-slate-500 font-bold text-[10px]">N/A (ข้าม)</span>
                            ) : (
                              <span className="text-slate-100">
                                {c.score}% &times; {Math.round(c.weight * 100)}% = <strong className="text-teal-400">{((c.score ?? 100) * c.weight).toFixed(1)}</strong>
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Right: Calculations step-by-step */}
                      <div className="flex flex-col justify-between space-y-3">
                        <div className="space-y-2">
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold block">1. ผลรวมคะแนนคูณน้ำหนัก Σ (Score &times; Weight):</span>
                            <span className="text-xs font-mono font-bold text-teal-400 flex flex-wrap items-center gap-1 mt-0.5">
                              {applicableCats.map(c => ((c.score ?? 100) * c.weight).toFixed(1)).join(' + ')}
                              {' = '}
                              <span className="text-white underline font-extrabold">{sumWeightedScores.toFixed(1)}</span>
                            </span>
                          </div>

                          <div>
                            <span className="text-[10px] text-slate-400 font-bold block">2. ผลรวมน้ำหนักที่ใช้งานจริง Σ Weight_Applicable:</span>
                            <span className="text-xs font-mono font-bold text-slate-200 mt-1 block">
                              {applicableCats.map(c => `${Math.round(c.weight * 100)}%`).join(' + ')}
                              {' = '}
                              <span className="text-teal-400 font-extrabold">{(sumWeights * 100).toFixed(0)}%</span> ({(sumWeights).toFixed(2)})
                            </span>
                          </div>
                        </div>

                        <div className="bg-slate-800 p-2.5 rounded-xl border border-slate-700/50 space-y-1">
                          <span className="text-[9px] text-slate-400 font-bold block">3. ดัชนีสุขภาพทั้งหมด (Health Index %):</span>
                          <div className="font-mono text-xs flex justify-between items-center">
                            <span className="text-slate-300 text-[11px]">
                              ({sumWeightedScores.toFixed(1)} / {(sumWeights).toFixed(2)})
                            </span>
                            <span className="text-lg font-black text-teal-300">
                              = {previewSubCal.score}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Category 1: Battery */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800">🔋 1. แบตเตอรี่ (น้ำกลั่น) - น้ำหนัก 25%</h4>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-400">
                        <input 
                          type="checkbox" 
                          checked={selectedSubForAudit.battery_na}
                          onChange={(e) => setSelectedSubForAudit({
                            ...selectedSubForAudit,
                            battery_na: e.target.checked
                          })}
                          className="rounded text-violet-650 focus:ring-violet-500"
                        />
                        ไม่มีอุปกรณ์นี้ (N/A)
                      </label>
                    </div>
                    
                    {!selectedSubForAudit.battery_na && (
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { val: 100, desc: "100% - ระดับน้ำกลั่นทุกลูกอยู่ระหว่างขีด Upper-Lower เห็นชัดเจนในรูป ขั้วแบตไม่มีคราบเกลือ" },
                          { val: 50, desc: "50% - มีบางลูกระดับน้ำเริ่มต่ำกว่ากึ่งกลางแต่ยังไม่พ้นขีดล่าง หรือภาพถ่ายเบลอจนระบุระดับได้ยาก" },
                          { val: 0, desc: "0% - น้ำกลั่นแห้งต่ำกว่าขีดล่าง หรือพบความผิดปกติที่ตัวถังแบตเตอรี่" }
                        ].map(opt => (
                          <label key={opt.val} className={cn("flex items-start gap-2.5 p-2 rounded-xl text-xs border transition-colors cursor-pointer",
                            selectedSubForAudit.battery_score === opt.val ? "bg-violet-50 border-violet-200 text-violet-700 font-bold" : "bg-slate-50 border-slate-100 hover:bg-slate-100/50"
                          )}>
                            <input 
                              type="radio" 
                              name="battery_score" 
                              checked={selectedSubForAudit.battery_score === opt.val}
                              onChange={() => setSelectedSubForAudit({ ...selectedSubForAudit, battery_score: opt.val })}
                              className="text-violet-600 focus:ring-violet-500 mt-0.5"
                            />
                            <span>{opt.desc}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Category 2: Yard */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800">⚡ 2. ลานไกสถานีไฟฟ้า - น้ำหนัก 20%</h4>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-400">
                        <input 
                          type="checkbox" 
                          checked={selectedSubForAudit.yard_na}
                          onChange={(e) => setSelectedSubForAudit({
                            ...selectedSubForAudit,
                            yard_na: e.target.checked
                          })}
                          className="rounded text-violet-600 focus:ring-violet-500"
                        />
                        ไม่มีอุปกรณ์นี้ (N/A)
                      </label>
                    </div>
                    
                    {!selectedSubForAudit.yard_na && (
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { val: 100, desc: "100% - พื้นลานกรวดไม่มีวัชพืช 100%, Bus bar สะอาดไม่มีเศษพลาสติก/สายสิญจน์/รังนก" },
                          { val: 70, desc: "70% - พบวัชพืชเล็กน้อย หรือมีคราบน้ำมันที่พื้น" },
                          { val: 30, desc: "30% - หญ้าสูงพ้นระดับหินกรวด หรือมีสิ่งแปลกปลอมใกล้ระยะ Flashover ของ Bus bar" },
                          { val: 0, desc: "0% - รกร้าง มีวัชพืชหนาแน่นจัด หรือมีสิ่งรุกล้ำระยะอันตรายไฟฟ้าแรงสูง" }
                        ].map(opt => (
                          <label key={opt.val} className={cn("flex items-start gap-2.5 p-2 rounded-xl text-xs border transition-colors cursor-pointer",
                            selectedSubForAudit.yard_score === opt.val ? "bg-violet-50 border-violet-200 text-violet-700 font-bold" : "bg-slate-50 border-slate-100 hover:bg-slate-100/50"
                          )}>
                            <input 
                              type="radio" 
                              name="yard_score" 
                              checked={selectedSubForAudit.yard_score === opt.val}
                              onChange={() => setSelectedSubForAudit({ ...selectedSubForAudit, yard_score: opt.val })}
                              className="text-violet-600 focus:ring-violet-500 mt-0.5"
                            />
                            <span>{opt.desc}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Category 3: Checklist */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800">📝 3. กระดาษ Check list (A4) - น้ำหนัก 15%</h4>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-400">
                        <input 
                          type="checkbox" 
                          checked={selectedSubForAudit.checklist_na}
                          onChange={(e) => setSelectedSubForAudit({
                            ...selectedSubForAudit,
                            checklist_na: e.target.checked
                          })}
                          className="rounded text-violet-600 focus:ring-violet-500"
                        />
                        ไม่มีอุปกรณ์นี้ (N/A)
                      </label>
                    </div>
                    
                    {!selectedSubForAudit.checklist_na && (
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { val: 100, desc: "100% - ภาพถ่ายเห็นชัดว่าลงบันทึกครบทุกช่อง, มีลายเซ็นผู้ตรวจและผู้ควบคุมงาน, วันที่ตรงกับวันปัจจุบัน" },
                          { val: 50, desc: "50% - ลงข้อมูลไม่ครบบางส่วน หรือลายมืออ่านยากมากจนอาจเกิดความเข้าใจผิด" },
                          { val: 0, desc: "0% - ไม่มีการลงบันทึก, วันที่ย้อนหลัง หรือไม่มีภาพถ่าย Checklist" }
                        ].map(opt => (
                          <label key={opt.val} className={cn("flex items-start gap-2.5 p-2 rounded-xl text-xs border transition-colors cursor-pointer",
                            selectedSubForAudit.checklist_score === opt.val ? "bg-violet-50 border-violet-200 text-violet-700 font-bold" : "bg-slate-50 border-slate-100 hover:bg-slate-100/50"
                          )}>
                            <input 
                              type="radio" 
                              name="checklist_score" 
                              checked={selectedSubForAudit.checklist_score === opt.val}
                              onChange={() => setSelectedSubForAudit({ ...selectedSubForAudit, checklist_score: opt.val })}
                              className="text-violet-600 focus:ring-violet-500 mt-0.5"
                            />
                            <span>{opt.desc}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Category 4: Roof */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800">🏢 4. ดาดฟ้าสถานี (ขี้นก/ระบายน้ำ) - น้ำหนัก 15%</h4>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-400">
                        <input 
                          type="checkbox" 
                          checked={selectedSubForAudit.roof_na}
                          onChange={(e) => setSelectedSubForAudit({
                            ...selectedSubForAudit,
                            roof_na: e.target.checked
                          })}
                          className="rounded text-violet-600 focus:ring-violet-500"
                        />
                        ไม่มีดาดฟ้า (N/A)
                      </label>
                    </div>
                    
                    {!selectedSubForAudit.roof_na && (
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { val: 100, desc: "100% - ปากท่อระบายน้ำสะอาด ไม่มีขี้นกสะสม หรือเศษวัสดุขวางทางน้ำ" },
                          { val: 50, desc: "50% - มีขี้นกสะสมบ้างแต่ยังไม่ส่งกลิ่นหรืออุดตัน" },
                          { val: 0, desc: "0% - ท่อระบายน้ำอุดตันชัดเจน หรือมีน้ำขังบนดาดฟ้า" }
                        ].map(opt => (
                          <label key={opt.val} className={cn("flex items-start gap-2.5 p-2 rounded-xl text-xs border transition-colors cursor-pointer",
                            selectedSubForAudit.roof_score === opt.val ? "bg-violet-50 border-violet-200 text-violet-700 font-bold" : "bg-slate-50 border-slate-100 hover:bg-slate-100/50"
                          )}>
                            <input 
                              type="radio" 
                              name="roof_score" 
                              checked={selectedSubForAudit.roof_score === opt.val}
                              onChange={() => setSelectedSubForAudit({ ...selectedSubForAudit, roof_score: opt.val })}
                              className="text-violet-600 focus:ring-violet-500 mt-0.5"
                            />
                            <span>{opt.desc}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Category 5: Fence */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800">🚧 5. รอบรั้วสถานี (4 ทิศทาง) - น้ำหนัก 15%</h4>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-400">
                        <input 
                          type="checkbox" 
                          checked={selectedSubForAudit.fence_na}
                          onChange={(e) => setSelectedSubForAudit({
                            ...selectedSubForAudit,
                            fence_na: e.target.checked
                          })}
                          className="rounded text-violet-600 focus:ring-violet-500"
                        />
                        ไม่มีรั้ว (N/A)
                      </label>
                    </div>
                    
                    {!selectedSubForAudit.fence_na && (
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { val: 100, desc: "100% - ภาพครบ 4 ด้าน, รั้วไม่มีช่องโหว่, ประตูล็อคสนิท, ป้ายเตือนอันตรายชัดเจน" },
                          { val: 50, desc: "50% - ขาดภาพบางด้าน หรือมีต้นไม้ขึ้นหนาจนมองไม่เห็นสภาพรั้ว" },
                          { val: 0, desc: "0% - รั้วชำรุด หรือมีการบุกรุก/สัตว์ทำรังขนาดใหญ่" }
                        ].map(opt => (
                          <label key={opt.val} className={cn("flex items-start gap-2.5 p-2 rounded-xl text-xs border transition-colors cursor-pointer",
                            selectedSubForAudit.fence_score === opt.val ? "bg-violet-50 border-violet-200 text-violet-700 font-bold" : "bg-slate-50 border-slate-100 hover:bg-slate-100/50"
                          )}>
                            <input 
                              type="radio" 
                              name="fence_score" 
                              checked={selectedSubForAudit.fence_score === opt.val}
                              onChange={() => setSelectedSubForAudit({ ...selectedSubForAudit, fence_score: opt.val })}
                              className="text-violet-600 focus:ring-violet-500 mt-0.5"
                            />
                            <span>{opt.desc}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Category 6: Security */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <h4 className="text-sm font-bold text-slate-800">👮 6. รปภ. (การแต่งเครื่องแบบ) - น้ำหนัก 10%</h4>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-400">
                        <input 
                          type="checkbox" 
                          checked={selectedSubForAudit.security_na}
                          onChange={(e) => setSelectedSubForAudit({
                            ...selectedSubForAudit,
                            security_na: e.target.checked
                          })}
                          className="rounded text-violet-600 focus:ring-violet-500"
                        />
                        ไม่มีจุดประจําการ (N/A)
                      </label>
                    </div>
                    
                    {!selectedSubForAudit.security_na && (
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { val: 100, desc: "100% - สวมเครื่องแบบตามระเบียบครบถ้วน รวมไปถึงอุปกรณ์ความปลอดภัย (ถ้ากำหนด)" },
                          { val: 0, desc: "0% - แต่งกายไม่เรียบร้อย (เช่น สวมรองเท้าแตะ, ไม่ใส่เสื้อเครื่องแบบ) หรือไม่อยู่ในจุดปฏิบัติงาน" }
                        ].map(opt => (
                          <label key={opt.val} className={cn("flex items-start gap-2.5 p-2 rounded-xl text-xs border transition-colors cursor-pointer",
                            selectedSubForAudit.security_score === opt.val ? "bg-violet-50 border-violet-200 text-violet-700 font-bold" : "bg-slate-50 border-slate-100 hover:bg-slate-100/50"
                          )}>
                            <input 
                              type="radio" 
                              name="security_score" 
                              checked={selectedSubForAudit.security_score === opt.val}
                              onChange={() => setSelectedSubForAudit({ ...selectedSubForAudit, security_score: opt.val })}
                              className="text-violet-600 focus:ring-violet-500 mt-0.5"
                            />
                            <span>{opt.desc}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Recommendations */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-2">
                    <h4 className="text-sm font-bold text-slate-800">✍️ ข้อเสนอแนะการปรับปรุงเพิ่มเติม</h4>
                    <textarea 
                      value={selectedSubForAudit.summary}
                      onChange={(e) => setSelectedSubForAudit({ ...selectedSubForAudit, summary: e.target.value })}
                      placeholder="ระบุความคิดเห็นเพื่อแนะนำให้สถานีไฟฟ้าแรงสูงทำความสะอาดเรียบร้อย เช่น จัดระเบียบสาย..."
                      rows={3}
                      className="w-full text-xs p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-violet-500"
                    />
                  </div>

                  {/* Overriding Status (Red/Green) */}
                  <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-2 flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">🚦 สถานะการควบคุมหลัก (Operational Status)</h4>
                      <p className="text-[10px] text-slate-400">ระบุสภาพความพร้อมทางกายภาพความปลอดภัย</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        type="button"
                        onClick={() => setSelectedSubForAudit({ ...selectedSubForAudit, status: 'Green' })}
                        className={cn("px-4 py-2 text-xs font-bold rounded-xl border transition-colors cursor-pointer",
                          selectedSubForAudit.status === 'Green' ? "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-100" : "bg-white text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        Green (ปกติ)
                      </button>
                      <button 
                        type="button"
                        onClick={() => setSelectedSubForAudit({ ...selectedSubForAudit, status: 'Red' })}
                        className={cn("px-4 py-2 text-xs font-bold rounded-xl border transition-colors cursor-pointer",
                          selectedSubForAudit.status === 'Red' ? "bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-100" : "bg-white text-slate-600 hover:bg-slate-50"
                        )}
                      >
                        Red (พบปัญหา)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="p-6 border-t border-slate-100 bg-white sticky bottom-0 z-10 flex gap-3">
                  <Button 
                    type="button"
                    onClick={() => setSelectedSubForAudit(null)} 
                    variant="outline"
                    className="flex-1 cursor-pointer font-bold"
                  >
                    ยกเลิก
                  </Button>
                  <Button 
                    type="button"
                    onClick={() => handleSaveAudit(selectedSubForAudit)} 
                    disabled={isSavingAudit}
                    className="flex-1 bg-violet-600 hover:bg-violet-700 flex items-center justify-center gap-2 cursor-pointer font-bold text-white shadow-lg shadow-violet-100"
                  >
                    {isSavingAudit ? (
                      <><Loader2 className="animate-spin w-4 h-4" /> บันทึก...</>
                    ) : (
                      <>บันทึกผลการประเมิน</>
                    )}
                  </Button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
};


// --- Main App ---

export default function App() {
  const [user, setUser] = useState<string | null>(localStorage.getItem('ssvi_user'));
  const [view, setView] = useState<'selection' | 'inspection' | 'dashboard' | 'success'>('selection');
  const [selectedSub, setSelectedSub] = useState<typeof SUBSTATIONS[0] | null>(null);

  const handleLogin = (id: string) => {
    localStorage.setItem('ssvi_user', id);
    setUser(id);
  };

  const handleLogout = () => {
    localStorage.removeItem('ssvi_user');
    setUser(null);
    setView('selection');
  };

  if (!user) return <LoginPage onLogin={handleLogin} />;

  return (
    <div className="font-sans text-slate-900">
      <AnimatePresence mode="wait">
        {view === 'selection' && (
          <motion.div key="selection" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <SelectionPage 
              onSelect={(sub) => {
                setSelectedSub(sub);
                setView('inspection');
              }} 
              onLogout={handleLogout}
            />
            {/* Floating Dashboard Button */}
            <button 
              onClick={() => setView('dashboard')}
              className="fixed bottom-6 right-6 w-14 h-14 bg-slate-900 text-white rounded-full shadow-xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-50"
            >
              <LayoutDashboard size={24} />
            </button>
          </motion.div>
        )}

        {view === 'inspection' && selectedSub && (
          <motion.div key="inspection" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}>
            <InspectionPage 
              substation={selectedSub} 
              employeeId={user}
              onBack={() => setView('selection')}
              onComplete={() => setView('success')}
            />
          </motion.div>
        )}

        {view === 'dashboard' && (
          <motion.div key="dashboard" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}>
            <DashboardPage onBack={() => setView('selection')} />
          </motion.div>
        )}

        {view === 'success' && (
          <motion.div key="success" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="min-h-screen bg-violet-600 flex flex-col items-center justify-center p-6 text-white text-center">
            <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 size={48} />
            </div>
            <h2 className="text-3xl font-bold mb-2">ส่งรายงานสำเร็จ!</h2>
            <p className="text-violet-100 mb-8">ขอบคุณสำหรับการปฏิบัติงานอย่างเคร่งครัด</p>
            <Button variant="secondary" onClick={() => setView('selection')} className="bg-white text-violet-700 hover:bg-violet-50">
              กลับหน้าหลัก
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
