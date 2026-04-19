"use client";

import { Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Driver {
  id: string;
  name: string;
  vehicle: string;
  status: string;
}

interface DriverSelectorProps {
  drivers: Driver[];
  selectedDriver: string | null;
  onSelectDriver: (driverId: string) => void;
}

export function DriverSelector({
  drivers,
  selectedDriver,
  onSelectDriver,
}: DriverSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-2">
        <Truck className="h-4 w-4 text-blue-500" />
        Выберите водителя
      </label>
      <Select
        value={selectedDriver || undefined}
        onValueChange={onSelectDriver}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Выберите водителя для отслеживания" />
        </SelectTrigger>
        <SelectContent>
          {drivers.map((driver) => (
            <SelectItem key={driver.id} value={driver.id}>
              <div className="flex items-center justify-between gap-4 w-full">
                <div>
                  <p className="font-medium">{driver.name}</p>
                  <p className="text-xs text-gray-500">{driver.vehicle}</p>
                </div>
                <Badge variant="outline" className="ml-2">
                  {driver.status}
                </Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
