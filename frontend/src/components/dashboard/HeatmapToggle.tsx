"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHeatmap, type HeatmapCell } from "@/lib/api";

interface HeatmapToggleProps {
  onData: (cells: HeatmapCell[] | null) => void;
}

export function HeatmapToggle({ onData }: HeatmapToggleProps) {
  const [enabled, setEnabled] = useState(false);

  const { isFetching } = useQuery({
    queryKey: ["heatmap"],
    queryFn: async () => {
      const data = await getHeatmap();
      onData(data);
      return data;
    },
    enabled,
    staleTime: 60_000,
  });

  const toggle = () => {
    if (enabled) {
      onData(null);
      setEnabled(false);
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
      Тепловая карта
    </Button>
  );
}
