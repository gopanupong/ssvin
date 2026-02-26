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
  Plus
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

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('bg-white rounded-2xl shadow-sm border border-slate-100 p-6', className)}>
    {children}
  </div>
);

// --- Pages ---

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
        
        <p className="mt-8 text-xs text-slate-400 uppercase tracking-widest font-semibold">
          Power Inspection System v1.0
        </p>
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
  const [photos, setPhotos] = useState<{ [key: string]: File[] }>({
    building: [],
    yard: [],
    roof: [],
  });
  const [checklists, setChecklists] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const isSubmitting = useRef(false);
  const [status, setStatus] = useState<string>('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

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

  useEffect(() => {
    getGeoLocation();
  }, []);

  const handleCapture = (key: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        setPhotos(prev => ({ ...prev, [key]: [...prev[key], file] }));
      }
    };
    input.click();
  };

  const handleAddChecklist = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        setChecklists(prev => [...prev, file]);
      }
    };
    input.click();
  };

  const handleSubmit = async () => {
    if (isSubmitting.current) return;
    
    if (!employeeId) {
      alert('ไม่พบรหัสพนักงาน กรุณาล็อกอินใหม่');
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
    
    isSubmitting.current = true;
    setUploading(true);
    setStatus('กำลังบีบอัดรูปภาพ...');
    console.log("Submitting inspection for employee:", employeeId);
    
    try {
      const formData = new FormData();
      formData.append('employeeId', employeeId);
      formData.append('substationName', substation.name);
      formData.append('lat', location?.lat.toString() || '0');
      formData.append('lng', location?.lng.toString() || '0');
      formData.append('timestamp', new Date().toISOString());

      const compressionOptions = {
        maxSizeMB: 0.7, // Target size under 1MB
        maxWidthOrHeight: 1280,
        useWebWorker: true
      };

      // Helper to add timestamp to image
      const addTimestampToImage = (file: File): Promise<Blob> => {
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
              
              // Measure text for background/position
              const textWidth = ctx.measureText(timestamp).width;
              const x = canvas.width - textWidth - 20;
              const y = canvas.height - 20;

              // Draw text shadow/outline for readability
              ctx.strokeStyle = 'black';
              ctx.lineWidth = 4;
              ctx.strokeText(timestamp, x, y);
              
              // Draw white text
              ctx.fillStyle = 'white';
              ctx.fillText(timestamp, x, y);

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

      // Helper to compress and append
      const appendCompressed = async (file: File, name: string) => {
        try {
          // 1. Add Timestamp
          const timestampedBlob = await addTimestampToImage(file);
          const timestampedFile = new File([timestampedBlob], name, { type: 'image/jpeg' });
          
          // 2. Compress
          const compressed = await imageCompression(timestampedFile, compressionOptions);
          formData.append('photos', compressed, name);
        } catch (e) {
          console.error("Processing failed, using original", e);
          formData.append('photos', file, name);
        }
      };

      const now = new Date();
      const timeStr = format(now, 'HHmm');
      const dateStr = now.toLocaleDateString("th-TH", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      }).replace(/\//g, "");
      const nameSuffix = `${timeStr}_${dateStr}`;

      // Append Fixed-Point photos
      for (const [key, files] of Object.entries(photos) as [string, File[]][]) {
        for (let i = 0; i < files.length; i++) {
          await appendCompressed(files[i], `${key}_${i + 1}_${nameSuffix}.jpg`);
        }
      }
      
      // Append Checklists
      for (let i = 0; i < checklists.length; i++) {
        await appendCompressed(checklists[i], `checklist_${i + 1}_${nameSuffix}.jpg`);
      }

      setStatus('กำลังส่งข้อมูลไปยัง Google Drive...');
      const res = await fetch('/api/upload-inspection', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        onComplete();
      } else {
        alert(`เกิดข้อผิดพลาด: ${data.error || 'ไม่สามารถอัปโหลดได้'}`);
      }
    } catch (err) {
      console.error(err);
      alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ หรือไฟล์มีขนาดใหญ่เกินไป (Vercel Limit 4.5MB)');
    } finally {
      setUploading(false);
      isSubmitting.current = false;
    }
  };

  const isReady = photos.building.length > 0 && photos.yard.length > 0 && photos.roof.length > 0 && checklists.length > 0;

  return (
    <div className="min-h-screen bg-violet-50 p-6 pb-32">
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
                { id: 'building', label: 'อาคารควบคุม', desc: 'ความสะอาดภายใน/ภายนอก' },
                { id: 'yard', label: 'ลานไกไฟฟ้า', desc: 'การจัดการวัชพืช/หญ้า' },
                { id: 'roof', label: 'หลังคาอาคาร', desc: 'สภาพความสะอาด/รอยรั่ว' },
              ].map((point) => (
                <div key={point.id} className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="font-bold text-slate-800 text-sm">{point.label}</h4>
                      <p className="text-[10px] text-slate-500">{point.desc}</p>
                    </div>
                    <button 
                      onClick={() => handleCapture(point.id)}
                      className="bg-violet-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 active:scale-95 transition-all"
                    >
                      <Plus size={14} /> เพิ่มรูป
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-2">
                    {photos[point.id].map((file, i) => (
                      <div key={i} className="aspect-square bg-slate-200 rounded-lg overflow-hidden relative group">
                        <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
                        <button 
                          onClick={() => setPhotos(prev => ({
                            ...prev,
                            [point.id]: prev[point.id].filter((_, idx) => idx !== i)
                          }))}
                          className="absolute top-0.5 right-0.5 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg text-xs"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {photos[point.id].length === 0 && (
                      <div className="col-span-4 py-4 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400">
                        <Camera size={20} className="mb-1 opacity-30" />
                        <span className="text-[10px]">ยังไม่มีรูปภาพ</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex justify-between items-center mb-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">กระดาษ Check List (A4)</p>
              <span className="text-xs font-bold text-violet-600 bg-violet-50 px-2 py-1 rounded-full">
                {checklists.length} แผ่น
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {checklists.map((file, i) => (
                <div key={i} className="aspect-square bg-slate-200 rounded-lg overflow-hidden relative group">
                  <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
                  <button 
                    onClick={() => setChecklists(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                onClick={handleAddChecklist}
                className="aspect-square border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:border-violet-500 hover:text-violet-500 transition-all"
              >
                <Plus size={20} />
                <span className="text-[8px] font-bold mt-1">เพิ่มหน้า</span>
              </button>
            </div>
          </section>
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-100 shadow-2xl">
          <div className="max-w-md mx-auto">
            <Button 
              onClick={handleSubmit} 
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

  useEffect(() => {
    setLoading(true);
    fetch(`/api/dashboard-stats?month=${selectedMonth + 1}&year=${selectedYear}`)
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      });
  }, [selectedMonth, selectedYear]);

  const pendingSubstations = SUBSTATIONS.filter(sub => 
    !stats.recent.some(log => log.substation_name === sub.name)
  );

  const inspectedSubstations = SUBSTATIONS.filter(sub => 
    stats.recent.some(log => log.substation_name === sub.name)
  ).map(sub => {
    // Find the latest inspection for this sub
    const latestLog = stats.recent.find(log => log.substation_name === sub.name);
    return { ...sub, latestLog };
  });

  return (
    <div className="min-h-screen bg-violet-50 p-6 relative">
      {loading && (
        <div className="absolute inset-0 bg-white/50 backdrop-blur-[2px] z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-violet-600" size={40} />
            <p className="text-sm font-bold text-violet-600">กำลังดึงข้อมูลจาก Google Sheets...</p>
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div key="total" className="cursor-pointer" onClick={() => setShowInspectedModal(true)}>
            <Card className="bg-violet-600 text-white border-none shadow-lg shadow-violet-200 hover:bg-violet-700 transition-all group">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-violet-100 text-xs font-bold uppercase tracking-wider mb-1">ตรวจสอบแล้ว ({months[selectedMonth].label})</p>
                  <h3 className="text-4xl font-bold">{stats.total} <span className="text-lg font-normal opacity-70">สถานี</span></h3>
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
                  <h3 className="text-4xl font-bold text-slate-800">{SUBSTATIONS.length - stats.total} <span className="text-lg font-normal opacity-40">สถานี</span></h3>
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
                {((stats.total / SUBSTATIONS.length) * 100).toFixed(1)}%
              </h3>
              <p className="text-[10px] text-slate-400 mt-1 font-bold">จากทั้งหมด {SUBSTATIONS.length} สถานี</p>
            </Card>
          </div>
        </div>

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
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase bg-violet-50 text-violet-600 px-2 py-1 rounded-full">
                        <CheckCircle2 size={12} /> เรียบร้อย
                      </span>
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
      </div>

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
                  {pendingSubstations.map((sub, idx) => (
                    <div key={sub.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs">
                        {(idx + 1).toString().padStart(2, '0')}
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-800 text-sm">{sub.name}</h5>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tighter">ยังไม่มีการตรวจสอบ</p>
                      </div>
                    </div>
                  ))}
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
