"""Medição de memória residente do leitor de documentos.

`peak_rss_mb` é o pico de memória residente do processo atual somado ao de
todos os seus subprocessos descendentes, capturando também o consumo do
processo filho do motor de OCR (Tesseract via pytesseract).
"""

from __future__ import annotations

import threading

import psutil

SAMPLE_INTERVAL_S = 0.05
_MB = 1024.0 * 1024.0


def _tree_rss_bytes(process: psutil.Process) -> int:
    total = 0
    try:
        total += process.memory_info().rss
        children = process.children(recursive=True)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return total
    for child in children:
        try:
            total += child.memory_info().rss
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            # Subprocesso terminou entre a listagem e a leitura.
            continue
    return total


class PeakRssSampler:
    """Amostra o RSS do processo + descendentes a cada 50 ms numa thread leve.

    Uso:
        sampler = PeakRssSampler(); sampler.start()
        ...leitura...
        peak_mb = sampler.stop()

    A amostra inicial (no `start`) entra no cálculo do pico.
    """

    def __init__(self, interval_s: float = SAMPLE_INTERVAL_S) -> None:
        self._process = psutil.Process()
        self._interval_s = interval_s
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="rss-sampler", daemon=True)
        self._peak_bytes = 0

    def _sample(self) -> None:
        self._peak_bytes = max(self._peak_bytes, _tree_rss_bytes(self._process))

    def _run(self) -> None:
        while not self._stop.wait(self._interval_s):
            self._sample()

    def start(self) -> None:
        self._sample()
        self._thread.start()

    def stop(self) -> float:
        self._stop.set()
        self._thread.join()
        self._sample()
        return self._peak_bytes / _MB
