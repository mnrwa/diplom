"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  alerts: string[];
  autoSpeak?: boolean;
}

export function VoiceAlerts({ alerts, autoSpeak = false }: Props) {
  const [enabled, setEnabled] = useState(autoSpeak);
  const [supported, setSupported] = useState(false);
  const spokenRef = useRef(new Set<string>());

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const speak = useCallback((text: string) => {
    if (!supported || !enabled) return;
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "ru-RU";
    utt.rate = 0.9;
    utt.pitch = 1;
    window.speechSynthesis.speak(utt);
  }, [supported, enabled]);

  useEffect(() => {
    if (!enabled || !alerts.length) return;
    const newAlerts = alerts.filter((a) => !spokenRef.current.has(a));
    for (const alert of newAlerts) {
      spokenRef.current.add(alert);
      speak(alert);
    }
  }, [alerts, enabled, speak]);

  if (!supported) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={enabled ? "default" : "outline"}
        size="sm"
        onClick={() => {
          if (enabled) window.speechSynthesis.cancel();
          setEnabled(!enabled);
        }}
        className="gap-2"
      >
        {enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        {enabled ? "Голос вкл." : "Голос выкл."}
      </Button>
      {enabled && alerts.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            spokenRef.current.clear();
            speak(alerts[0]);
          }}
          className="text-xs text-gray-500"
        >
          Повторить
        </Button>
      )}
    </div>
  );
}
