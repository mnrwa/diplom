"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAiHeatmap, type HeatmapCell } from "@/lib/api";
import { toast } from "@/lib/sonner";

interface HeatmapToggleProps {
  onData: (cells: HeatmapCell[] | null) => void;
}

export function HeatmapToggle({ onData }: HeatmapToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState(0);

  const { isFetching } = useQuery({
    queryKey: ["ai-heatmap"],
    queryFn: async () => {
      const data = await getAiHeatmap();
      onData(data);
      setCount(data.length);
      const highways = new Set(data.map((d) => d.highway).filter(Boolean)).size;
      toast.success("Нагрузка дорог загружена", {
        description: `${data.length} точек · ${highways} трасс`,
      });
      return data;
    },
    enabled,
    staleTime: 120_000,
  });

  const toggle = () => {
    if (enabled) {
      onData(null);
      setEnabled(false);
      setCount(0);
    } else {
      setEnabled(true);
    }
  };

  return (
    <Button
      variant={enabled ? "default" : "outline"}
      size="sm"
      onClick={toggle}
      className="gap-2"
    >
      {isFetching ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Flame className="h-4 w-4" />
      )}
      {isFetching
        ? "Загружаем..."
        : enabled
          ? `Скрыть (${count} точек)`
          : "Нагрузка дорог"}
    </Button>
  );
}
