import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const SUBSTATIONS = [
  { id: "sam-chuk", name: "สามชุก", lat: 14.755, lng: 100.095 },
  { id: "si-prachan", name: "ศรีประจันต์", lat: 14.625, lng: 100.142 },
  { id: "dan-chang", name: "ด่านช้าง", lat: 14.838, lng: 99.695 },
  { id: "doem-bang", name: "เดิมบางนางบวช", lat: 14.855, lng: 100.045 },
  { id: "suphan-buri-1", name: "สุพรรณบุรี 1", lat: 14.475, lng: 100.122 },
  { id: "suphan-buri-2", name: "สุพรรณบุรี 2", lat: 14.455, lng: 100.105 },
];

export interface InspectionLog {
  id: number;
  employee_id: string;
  substation_name: string;
  timestamp: string;
  gps_lat: number;
  gps_lng: number;
  folder_id: string;
  status: string;
}
