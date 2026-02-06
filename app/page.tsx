"use client";

import { useEffect, useMemo, useState } from "react";
import { getCsvTemplate, parseCsv } from "../lib/csv";
import { optimizeSlatesForDates } from "../lib/optimizer";
import { PatientCase, ScoredCase } from "../lib/types";
import { formatMinutesToTime, getBlockMinutes, getBlockStartMinutes } from "../lib/date";

function downloadFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [csvText, setCsvText] = useState("");
  const [cases, setCases] = useState<PatientCase[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [priorityMode, setPriorityMode] = useState<"ttt" | "urgency_then_ttt">(
    "urgency_then_ttt"
  );
  const [slateCount, setSlateCount] = useState(1);
  const [slateDates, setSlateDates] = useState<string[]>(() => {
    const today = new Date();
    const dates = [0, 1, 2].map((offset) => {
      const next = new Date(today);
      next.setDate(today.getDate() + offset);
      return next.toISOString().slice(0, 10);
    });
    return dates;
  });
  const [selectedSurgeon, setSelectedSurgeon] = useState<string>("");
  const [orderedSlates, setOrderedSlates] = useState<ScoredCase[][]>([]);
  const [dragState, setDragState] = useState<{ slateIndex: number; caseId: string } | null>(
    null
  );

  useEffect(() => {
    if (!csvText) return;
    const result = parseCsv(csvText);
    setCases(result.cases);
    setWarnings(result.warnings);
    if (!selectedSurgeon && result.cases.length > 0) {
      setSelectedSurgeon(result.cases[0].surgeonId);
    }
  }, [csvText, selectedSurgeon]);

  const surgeons = useMemo(() => {
    const unique = new Set(cases.map((item) => item.surgeonId));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [cases]);

  const filteredCases = useMemo(() => {
    if (!selectedSurgeon) return cases;
    return cases.filter((item) => item.surgeonId === selectedSurgeon);
  }, [cases, selectedSurgeon]);

  const sortByPriorityMode = (items: ScoredCase[] | PatientCase[]) => {
    const order = [2, 4, 6, 12, 26];
    return [...items].sort((a, b) => {
      if (priorityMode === "ttt") {
        return a.timeToTargetDays - b.timeToTargetDays;
      }
      const aGroup = order.indexOf(a.benchmarkWeeks);
      const bGroup = order.indexOf(b.benchmarkWeeks);
      if (aGroup !== bGroup) return aGroup - bGroup;
      return a.timeToTargetDays - b.timeToTargetDays;
    });
  };

  const slates = useMemo(() => {
    if (filteredCases.length === 0) return null;
    const dates = slateDates
      .slice(0, slateCount)
      .filter(Boolean)
      .map((date) => new Date(`${date}T00:00:00`));
    if (dates.length === 0) return null;
    return optimizeSlatesForDates(filteredCases, dates);
  }, [filteredCases, slateDates, slateCount]);

  useEffect(() => {
    if (!slates) {
      setOrderedSlates([]);
      return;
    }
    setOrderedSlates(slates.map((item) => sortByPriorityMode(item.selected)));
  }, [slates, priorityMode]);

  const blockMinutes = useMemo(() => {
    if (!slateDates[0]) return 0;
    const date = new Date(`${slateDates[0]}T00:00:00`);
    return getBlockMinutes(date);
  }, [slateDates]);

  const blockStartMinutes = useMemo(() => {
    if (!slateDates[0]) return 0;
    const date = new Date(`${slateDates[0]}T00:00:00`);
    return getBlockStartMinutes(date);
  }, [slateDates]);

  const buildSchedule = (items: ScoredCase[], slateIndex: number) => {
    const date = new Date(`${slateDates[slateIndex]}T00:00:00`);
    let cursor = getBlockStartMinutes(date);
    return items.map((item) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      cursor = end;
      return { item, start, end };
    });
  };

  const updateSlateDate = (index: number, value: string) => {
    setSlateDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsvText(text);
    };
    reader.readAsText(file);
  };

  const handleDragStart = (slateIndex: number, caseId: string) => {
    setDragState({ slateIndex, caseId });
  };

  const handleDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    slateIndex: number,
    caseId: string
  ) => {
    event.preventDefault();
    if (!dragState || dragState.caseId === caseId || dragState.slateIndex !== slateIndex) {
      return;
    }
    setOrderedSlates((prev) => {
      const next = prev.map((slate) => [...slate]);
      const slate = next[slateIndex];
      if (!slate) return prev;
      const fromIndex = slate.findIndex((item) => item.caseId === dragState.caseId);
      const toIndex = slate.findIndex((item) => item.caseId === caseId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = slate.splice(fromIndex, 1);
      slate.splice(toIndex, 0, moved);
      return next;
    });
  };

  const downloadSlateCsv = (slateIndex: number) => {
    if (!slates || !orderedSlates[slateIndex]) return;
    const orderedSlate = orderedSlates[slateIndex];
    const date = new Date(`${slateDates[slateIndex]}T00:00:00`);
    const startMinutes = getBlockStartMinutes(date);
    const rows = [
      [
        "order",
        "case_id",
        "start_time",
        "end_time",
        "patient_type",
        "procedure_name",
        "benchmark_weeks",
        "time_to_target_days",
        "estimated_duration_min",
        "surgeon_id",
        "osa",
        "diabetes",
        "risk_score",
      ],
    ];

    let cursor = startMinutes;
    orderedSlate.forEach((item, index) => {
      const start = cursor;
      const end = cursor + Math.round(item.estimatedDurationMin);
      cursor = end;
      rows.push([
        String(index + 1),
        item.caseId,
        formatMinutesToTime(start),
        formatMinutesToTime(end),
        item.inpatient ? "Inpatient" : "Day Case",
        item.procedureName ?? "",
        String(item.benchmarkWeeks),
        String(item.timeToTargetDays),
        String(item.estimatedDurationMin),
        item.surgeonId,
        item.flags.osa ? "yes" : "no",
        item.flags.diabetes ? "yes" : "no",
        item.riskScore.toFixed(2),
      ]);
    });

    const csv = rows.map((row) => row.join(",")).join("\n");
    downloadFile(`surgical_slate_${slateDates[slateIndex]}_s${slateIndex + 1}.csv`, csv);
  };

  const downloadMappingCsv = (slateIndex: number) => {
    if (!orderedSlates[slateIndex] || orderedSlates[slateIndex].length === 0) return;
    const rows = [["case_id", "source_key"]];
    orderedSlates[slateIndex].forEach((item) => rows.push([item.caseId, item.sourceKey]));
    const csv = rows.map((row) => row.join(",")).join("\n");
    downloadFile(`case_mapping_${slateDates[slateIndex]}_s${slateIndex + 1}.csv`, csv);
  };

  const orderedByUrgency = useMemo(() => {
    return sortByPriorityMode(filteredCases);
  }, [filteredCases, priorityMode]);

  const downloadPriorityCsv = () => {
    if (orderedByUrgency.length === 0) return;
    const rows = [
      [
        "order",
        "case_id",
        "patient_type",
        "benchmark_weeks",
        "time_to_target_days",
        "estimated_duration_min",
        "surgeon_id",
        "procedure_name",
      ],
    ];
    orderedByUrgency.forEach((item, index) => {
      rows.push([
        String(index + 1),
        item.caseId,
        item.inpatient ? "Inpatient" : "Day Case",
        String(item.benchmarkWeeks),
        String(item.timeToTargetDays),
        String(item.estimatedDurationMin),
        item.surgeonId,
        item.procedureName ?? "",
      ]);
    });
    const csv = rows.map((row) => row.join(",")).join("\n");
    downloadFile(`priority_waitlist_${selectedSurgeon || "all"}.csv`, csv);
  };

  const scrollToAbout = () => {
    const section = document.getElementById("about");
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-sand-600">Slate Builder</p>
            <h1 className="mt-2 text-4xl font-semibold text-slateBlue-900">
              SlateBuilder Pro
            </h1>
          </div>
          <div className="rounded-full border border-sand-300 bg-white/80 px-4 py-2 text-xs text-sand-700">
            Single-day, single-surgeon slate optimization (up to 3 selectable dates)
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-sand-600">
          <button
            type="button"
            onClick={scrollToAbout}
            className="rounded-full border border-sand-300 bg-white/70 px-3 py-1 font-semibold text-slateBlue-700"
          >
            About SlateBuilder Pro
          </button>
        </div>
        <p className="max-w-2xl text-base text-sand-800">
          Upload a deidentified waitlist, prioritize by benchmark time and time-to-target, and
          maximize OR utilization. Drag to reorder cases after optimization for clinical
          considerations such as OSA or diabetes.
        </p>
        <p className="max-w-2xl text-xs text-sand-600">
          Privacy note: all processing happens locally in your browser. No data is uploaded or sent
          over the internet.
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">1. Load Waitlist</h2>
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-xl border border-dashed border-sand-300 bg-white/70 p-4">
              <input
                type="file"
                accept=".csv"
                onChange={handleUpload}
                className="w-full text-sm"
              />
            </div>


            {warnings.length > 0 && (
              <div className="rounded-lg border border-sand-200 bg-sand-50 px-4 py-3 text-xs text-sand-800">
                <p className="font-semibold text-sand-900">Parsing warnings</p>
                <ul className="mt-2 list-disc pl-4">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-sand-200 bg-white/70 p-4 text-sm text-sand-800">
              <p className="font-semibold text-sand-900">Priority rule</p>
              <div className="mt-3 flex flex-col gap-3">
                <label className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="priority"
                    value="urgency_then_ttt"
                    checked={priorityMode === "urgency_then_ttt"}
                    onChange={() => setPriorityMode("urgency_then_ttt")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold">
                      Prioritize by clinical urgency then wait time
                    </span>
                    <span className="block text-xs text-sand-600">
                      Sort by benchmark (2w, 4w, 6w, 12w, 26w) and then TTT.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="priority"
                    value="ttt"
                    checked={priorityMode === "ttt"}
                    onChange={() => setPriorityMode("ttt")}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold">Prioritize by absolute wait time only</span>
                    <span className="block text-xs text-sand-600">
                      Sort by time-to-target (TTT) regardless of urgency class.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slateBlue-900">2. Select OR Days</h2>
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-2 text-sm text-sand-800">
              Number of slates (up to 3)
              <select
                value={slateCount}
                onChange={(event) => setSlateCount(Number(event.target.value))}
                className="rounded-lg border border-sand-300 bg-white px-3 py-2"
              >
                <option value={1}>1 slate</option>
                <option value={2}>2 slates</option>
                <option value={3}>3 slates</option>
              </select>
            </label>

            <div className="flex flex-col gap-3">
              {Array.from({ length: slateCount }).map((_, index) => (
                <label key={`date-${index}`} className="flex flex-col gap-2 text-sm text-sand-800">
                  OR date for slate {index + 1}
                  <input
                    type="date"
                    value={slateDates[index] || ""}
                    onChange={(event) => updateSlateDate(index, event.target.value)}
                    className="rounded-lg border border-sand-300 bg-white px-3 py-2"
                  />
                </label>
              ))}
            </div>

            <label className="flex flex-col gap-2 text-sm text-sand-800">
              Surgeon
              <select
                value={selectedSurgeon}
                onChange={(event) => setSelectedSurgeon(event.target.value)}
                className="rounded-lg border border-sand-300 bg-white px-3 py-2"
              >
                {surgeons.length === 0 && <option value="">No surgeons found</option>}
                {surgeons.map((surgeon) => (
                  <option key={surgeon} value={surgeon}>
                    {surgeon}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">3. Optimized Slates</h2>
              <p className="text-sm text-sand-700">Drag to reorder for clinical priorities.</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-sand-200 bg-white/70 px-4 py-3 text-sm text-sand-800">
            <p className="font-semibold text-sand-900">Block length</p>
            <p className="mt-1">{blockMinutes} minutes</p>
            <p className="mt-2 text-xs text-sand-700">
              Standard day: 08:00–16:00 (480 min). 2nd &amp; 4th Thursday: 09:00–16:00 (420 min).
            </p>
          </div>

          {!slates && (
            <div className="mt-6 rounded-xl border border-dashed border-sand-300 bg-white/70 p-6 text-sm text-sand-700">
              Upload a CSV to generate the slate.
            </div>
          )}

          {slates && slates.length === 0 && (
            <div className="mt-6 rounded-xl border border-dashed border-sand-300 bg-white/70 p-6 text-sm text-sand-700">
              No cases fit into the block length for the selected day.
            </div>
          )}

          {slates && slates.length > 0 && (
            <div className="mt-6 flex flex-col gap-6">
              {slates.map((slate, slateIndex) => {
                const orderedSlate = orderedSlates[slateIndex] ?? slate.selected;
                const schedule = buildSchedule(orderedSlate, slateIndex);
                const slateDate = slateDates[slateIndex];
                const slateStart = slateDate
                  ? getBlockStartMinutes(new Date(`${slateDate}T00:00:00`))
                  : blockStartMinutes;
                return (
                  <div key={`slate-${slateIndex}`} className="rounded-2xl border border-sand-200 bg-white/70 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">
                          Slate {slateIndex + 1}
                        </p>
                        <h3 className="mt-1 text-lg font-semibold text-slateBlue-900">
                          {orderedSlate.length} cases · {slate.utilizationPct.toFixed(1)}% utilization
                        </h3>
                        <p className="mt-1 text-xs text-sand-700">
                          Date {slateDate || "Not set"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => downloadSlateCsv(slateIndex)}
                          className="rounded-full bg-slateBlue-700 px-4 py-2 text-xs font-semibold text-white"
                        >
                          Export slate CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadMappingCsv(slateIndex)}
                          className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
                        >
                          Export case mapping
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-sand-200 bg-white/70 p-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">Utilization</p>
                        <p className="mt-1 text-xl font-semibold text-slateBlue-900">
                          {slate.utilizationPct.toFixed(1)}%
                        </p>
                        <p className="text-xs text-sand-700">
                          {slate.totalMinutes.toFixed(0)} / {slate.blockMinutes} min
                        </p>
                      </div>
                      <div className="rounded-xl border border-sand-200 bg-white/70 p-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">Total Risk</p>
                        <p className="mt-1 text-xl font-semibold text-slateBlue-900">
                          {slate.totalRiskScore.toFixed(1)}
                        </p>
                        <p className="text-xs text-sand-700">
                          Util weight {slate.utilizationWeight.toFixed(3)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-sand-200 bg-white/70 p-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-sand-600">Start Time</p>
                        <p className="mt-1 text-xl font-semibold text-slateBlue-900">
                          {formatMinutesToTime(slateStart)}
                        </p>
                        <p className="text-xs text-sand-700">Day start</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      {schedule.map(({ item, start, end }, index) => (
                        <div
                          key={item.caseId}
                          draggable
                          onDragStart={() => handleDragStart(slateIndex, item.caseId)}
                          onDragOver={(event) => handleDragOver(event, slateIndex, item.caseId)}
                          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-sand-200 bg-white px-4 py-3 text-sm shadow-sm"
                        >
                          <div>
                            <p className="text-xs uppercase tracking-[0.2em] text-sand-500">
                              #{index + 1} · {formatMinutesToTime(start)}–{formatMinutesToTime(end)}
                            </p>
                            <p className="font-semibold text-slateBlue-900">{item.caseId}</p>
                            <p className="text-xs text-sand-700">
                              Benchmark {item.benchmarkWeeks}w · TTT {item.timeToTargetDays}d · {item.estimatedDurationMin}m
                            </p>
                            {item.procedureName && (
                              <p className="text-xs text-sand-600">{item.procedureName}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-sand-700">
                            {item.flags.osa && (
                              <span className="rounded-full bg-sand-100 px-2 py-1">OSA</span>
                            )}
                            {item.flags.diabetes && (
                              <span className="rounded-full bg-sand-100 px-2 py-1">Diabetes</span>
                            )}
                          <span className="rounded-full bg-slateBlue-50 px-2 py-1 text-slateBlue-700">
                            Risk {item.riskScore.toFixed(2)}
                          </span>
                          {item.inpatient && (
                            <span className="rounded-full bg-sand-200 px-2 py-1 text-sand-800">
                              Inpatient
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slateBlue-900">Priority Waitlist</h2>
              <p className="text-sm text-sand-700">
                {priorityMode === "ttt"
                  ? "Sorted by time-to-target (TTT) regardless of urgency class."
                  : "Sorted by urgency class (2w→26w), then days to target."}
              </p>
              <p className="mt-1 text-xs text-sand-600">
                {selectedSurgeon
                  ? `${orderedByUrgency.length} cases for ${selectedSurgeon}`
                  : `${orderedByUrgency.length} cases`}
              </p>
            </div>
            <button
              type="button"
              onClick={downloadPriorityCsv}
              className="rounded-full border border-slateBlue-200 px-4 py-2 text-xs font-semibold text-slateBlue-700"
            >
              Export priority list
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2 text-sm">
            {orderedByUrgency.map((item, index) => (
              <div key={item.caseId} className="rounded-lg border border-sand-200 bg-white/70 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slateBlue-900">
                    #{index + 1} · {item.caseId}
                  </span>
                  <span className="text-xs text-sand-700">{item.estimatedDurationMin}m</span>
                </div>
                <div className="text-xs text-sand-700">
                  Benchmark {item.benchmarkWeeks}w · TTT {item.timeToTargetDays}d
                </div>
                {item.inpatient && (
                  <span className="rounded-full bg-sand-200 px-2 py-1 text-xs text-sand-800">
                    Inpatient
                  </span>
                )}
                {item.procedureName && (
                  <div className="text-xs text-sand-600">{item.procedureName}</div>
                )}
              </div>
            ))}
            {orderedByUrgency.length === 0 && (
              <div className="rounded-lg border border-dashed border-sand-300 bg-white/70 px-3 py-6 text-center text-xs text-sand-700">
                No cases loaded for this surgeon.
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="about" className="card p-6 scroll-mt-24">
        <h2 className="text-lg font-semibold text-slateBlue-900">About</h2>
        <p className="mt-2 text-sm text-sand-800">
          SlateBuilder Pro was designed by Dr Jonathan Collins for BC Women&apos;s Hospital Surgical
          Services use only. It was built using an AI tool, and the designer takes no responsibility
          for any errors or omissions in outputs.
        </p>
      </section>
    </main>
  );
}
