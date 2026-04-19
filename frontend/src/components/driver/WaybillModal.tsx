"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  Download,
  FileText,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getWaybill, signWaybill } from "@/lib/api";

interface Props {
  routeId: number;
}

export function WaybillCard({ routeId }: Props) {
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSig, setHasSig] = useState(false);

  const { data: waybill, isLoading } = useQuery({
    queryKey: ["waybill", routeId],
    queryFn: () => getWaybill(routeId),
  });

  const signMut = useMutation({
    mutationFn: (sig: string) => signWaybill(routeId, sig),
    onSuccess: () => {
      toast.success("Путевой лист подписан");
      qc.invalidateQueries({ queryKey: ["waybill", routeId] });
    },
  });

  // Canvas drawing
  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
    setHasSig(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e293b";
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDraw = () => setDrawing(false);

  const clearSig = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  };

  const handleSign = () => {
    const canvas = canvasRef.current!;
    const sig = canvas.toDataURL("image/png");
    signMut.mutate(sig);
  };

  const handleDownload = () => {
    if (!waybill) return;
    const text = `ПУТЕВОЙ ЛИСТ\n\nМаршрут #${waybill.routeId}\nВодитель: ${waybill.driverName}\nТС: ${waybill.vehiclePlate}\nГруз: ${waybill.cargoDesc ?? "—"}\nСтатус: ${waybill.status === "SIGNED" ? "Подписан" : "Черновик"}\nДата: ${new Date(waybill.createdAt).toLocaleDateString("ru")}`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waybill-${routeId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>;
  if (!waybill) return null;

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-500" />
          Путевой лист
        </CardTitle>
        <CardDescription>
          {waybill.status === "SIGNED" ? "✅ Подписан" : "Требуется подпись водителя"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="text-gray-400 text-xs">Водитель</p>
            <p className="font-semibold">{waybill.driverName}</p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="text-gray-400 text-xs">Транспорт</p>
            <p className="font-semibold">{waybill.vehiclePlate}</p>
          </div>
          <div className="col-span-2 rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="text-gray-400 text-xs">Груз / маршрут</p>
            <p className="font-semibold">{waybill.cargoDesc ?? "—"}</p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="text-gray-400 text-xs">Дата</p>
            <p className="font-semibold">{new Date(waybill.createdAt).toLocaleDateString("ru")}</p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
            <p className="text-gray-400 text-xs">Статус</p>
            <p className={`font-semibold ${waybill.status === "SIGNED" ? "text-emerald-600" : "text-amber-600"}`}>
              {waybill.status === "SIGNED" ? "Подписан" : "Черновик"}
            </p>
          </div>
        </div>

        {waybill.status !== "SIGNED" && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700">Подпись водителя</p>
            <div className="relative rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 overflow-hidden">
              <canvas
                ref={canvasRef}
                width={500}
                height={120}
                className="w-full touch-none cursor-crosshair"
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={stopDraw}
              />
              {!hasSig && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 pointer-events-none">
                  Нарисуйте подпись
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clearSig} disabled={!hasSig} className="gap-2">
                <RotateCcw className="h-4 w-4" />Очистить
              </Button>
              <Button
                size="sm"
                onClick={handleSign}
                disabled={!hasSig || signMut.isPending}
                className="gap-2 bg-emerald-500 hover:bg-emerald-600"
              >
                {signMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Подписать
              </Button>
            </div>
          </div>
        )}

        {waybill.status === "SIGNED" && waybill.signatureData && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">Подпись водителя</p>
            <img src={waybill.signatureData} alt="Подпись" className="max-h-20 border border-gray-200 rounded-lg" />
          </div>
        )}

        <Button variant="outline" size="sm" className="w-full gap-2" onClick={handleDownload}>
          <Download className="h-4 w-4" />
          Скачать путевой лист
        </Button>
      </CardContent>
    </Card>
  );
}
