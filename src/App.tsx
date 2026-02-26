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
  const [nearest, setNearest] = useState<typeof SUBSTATIONS[0] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        let minDest = Infinity;
        let closest = SUBSTATIONS[0];
        
        SUBSTATIONS.forEach(sub => {
          const d = Math.sqrt(Math.pow(sub.lat - latitude, 2) + Math.pow(sub.lng - longitude, 2));
          if (d < minDest) {
            minDest = d;
            closest = sub;
          }
        });
        setNearest(closest);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  return (
    <div className="min-h-screen bg-violet-50 p-6 pb-24">
      <div className="max-w-md mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-xl font-bold text-slate-900">เลือกสถานีไฟฟ้า</h2>
          <button onClick={onLogout} className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
            <LogOut size={20} />
          </button>
        </div>

        {nearest && (
          <div className="mb-8">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">สถานีที่ใกล้คุณที่สุด</p>
            <motion.div 
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(nearest)}
              className="bg-violet-600 p-6 rounded-2xl text-white shadow-lg shadow-violet-200 cursor-pointer relative overflow-hidden group"
            >
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin size={16} className="text-violet-200" />
                  <span className="text-violet-100 text-sm font-medium">ตรวจพบพิกัดปัจจุบัน</span>
                </div>
                <h3 className="text-2xl font-bold">{nearest.name}</h3>
              </div>
              <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 opacity-50 group-hover:opacity-100 transition-opacity" />
              <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
            </motion.div>
          </div>
        )}

        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">รายชื่อสถานีทั้งหมด</p>
        <div className="space-y-3">
          {SUBSTATIONS.map((sub) => (
            <div key={sub.id}>
              <Card className="p-0 overflow-hidden">
                <button 
                  onClick={() => onSelect(sub)}
                  className="w-full p-5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
                >
                  <div>
                    <h4 className="font-bold text-slate-800">{sub.name}</h4>
                    <p className="text-xs text-slate-500">สถานีไฟฟ้าแรงสูง</p>
                  </div>
                  <ChevronRight size={18} className="text-slate-300" />
                </button>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const InspectionPage = ({ substation, employeeId, onBack, onComplete }: { substation: typeof SUBSTATIONS[0]; employeeId: string; onBack: () => void; onComplete: () => void }) => {
  const [photos, setPhotos] = useState<{ [key: string]: File | null }>({
    building: null,
    yard: null,
    roof: null,
  });
  const [checklists, setChecklists] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });
  }, []);

  const handleCapture = (key: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        setPhotos(prev => ({ ...prev, [key]: file }));
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
    setUploading(true);
    const formData = new FormData();
    formData.append('employeeId', employeeId);
    formData.append('substationName', substation.name);
    formData.append('lat', location?.lat.toString() || '0');
    formData.append('lng', location?.lng.toString() || '0');
    formData.append('timestamp', new Date().toISOString());

    if (photos.building) formData.append('photos', photos.building, 'building.jpg');
    if (photos.yard) formData.append('photos', photos.yard, 'yard.jpg');
    if (photos.roof) formData.append('photos', photos.roof, 'roof.jpg');
    checklists.forEach((file, i) => {
      formData.append('photos', file, `checklist_${i + 1}.jpg`);
    });

    try {
      const res = await fetch('/api/upload-inspection', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        onComplete();
      } else {
        alert('เกิดข้อผิดพลาดในการอัปโหลด');
      }
    } catch (err) {
      alert('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setUploading(false);
    }
  };

  const isReady = photos.building && photos.yard && photos.roof && checklists.length > 0;

  return (
    <div className="min-h-screen bg-violet-50 p-6 pb-32">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="p-2 -ml-2 text-slate-400 hover:text-slate-900">
            <ChevronRight size={24} className="rotate-180" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{substation.name}</h2>
            <p className="text-xs font-semibold text-violet-600 uppercase tracking-wider">รายงานประจำเดือน</p>
          </div>
        </div>

        <div className="space-y-6">
          <section>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">จุดตรวจสอบมาตรฐาน (Fixed-Point)</p>
            <div className="grid gap-4">
              {[
                { id: 'building', label: 'อาคารควบคุม', desc: 'ความสะอาดภายใน/ภายนอก' },
                { id: 'yard', label: 'ลานไกไฟฟ้า', desc: 'การจัดการวัชพืช/หญ้า' },
                { id: 'roof', label: 'หลังคาอาคาร', desc: 'สภาพความสะอาด/รอยรั่ว' },
              ].map((point) => (
                <div key={point.id}>
                  <Card className="p-4 flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                      photos[point.id] ? "bg-violet-100 text-violet-600" : "bg-slate-100 text-slate-400"
                    )}>
                      {photos[point.id] ? <CheckCircle2 size={24} /> : <Camera size={24} />}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-slate-800 text-sm">{point.label}</h4>
                      <p className="text-xs text-slate-500">{point.desc}</p>
                    </div>
                    <button 
                      onClick={() => handleCapture(point.id)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                        photos[point.id] ? "bg-slate-100 text-slate-600" : "bg-violet-600 text-white"
                      )}
                    >
                      {photos[point.id] ? 'ถ่ายใหม่' : 'ถ่ายภาพ'}
                    </button>
                  </Card>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">กระดาษ Check List (A4)</p>
              <span className="text-xs font-bold text-violet-600 bg-violet-50 px-2 py-1 rounded-full">
                {checklists.length} แผ่น
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {checklists.map((file, i) => (
                <div key={i} className="aspect-square bg-slate-200 rounded-xl overflow-hidden relative group">
                  <img src={URL.createObjectURL(file)} className="w-full h-full object-cover" />
                  <button 
                    onClick={() => setChecklists(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button 
                onClick={handleAddChecklist}
                className="aspect-square border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:border-violet-500 hover:text-violet-500 transition-all"
              >
                <Plus size={24} />
                <span className="text-[10px] font-bold mt-1">เพิ่มหน้า</span>
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
                  <Loader2 className="animate-spin" /> กำลังส่งข้อมูล...
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
  const [stats, setStats] = useState<{ total: number; recent: InspectionLog[] }>({ total: 0, recent: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard-stats')
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-violet-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 -ml-2 text-slate-400 hover:text-slate-900">
              <ChevronRight size={24} className="rotate-180" />
            </button>
            <h2 className="text-2xl font-bold text-slate-900">Executive Dashboard</h2>
          </div>
          <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">เดือนปัจจุบัน</span>
            <span className="font-bold text-slate-800">{format(new Date(), 'MMMM yyyy', { locale: th })}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div key="total">
            <Card className="bg-violet-600 text-white border-none shadow-lg shadow-violet-200">
              <p className="text-violet-100 text-xs font-bold uppercase tracking-wider mb-1">ตรวจสอบแล้ว</p>
              <h3 className="text-4xl font-bold">{stats.total} <span className="text-lg font-normal opacity-70">สถานี</span></h3>
            </Card>
          </div>
          <div key="pending">
            <Card>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">รอดำเนินการ</p>
              <h3 className="text-4xl font-bold text-slate-800">{SUBSTATIONS.length - stats.total} <span className="text-lg font-normal opacity-40">สถานี</span></h3>
            </Card>
          </div>
          <div key="coverage">
            <Card>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">ความครอบคลุม</p>
              <h3 className="text-4xl font-bold text-slate-800">{Math.round((stats.total / SUBSTATIONS.length) * 100)}%</h3>
            </Card>
          </div>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="p-6 border-bottom border-slate-100 flex justify-between items-center">
            <h4 className="font-bold text-slate-800">ประวัติการตรวจสอบล่าสุด</h4>
            <button className="text-violet-600 text-sm font-bold hover:underline">ดูทั้งหมด</button>
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
