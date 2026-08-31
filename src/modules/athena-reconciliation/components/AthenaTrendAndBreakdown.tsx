'use client';

import React, { useState, useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import {
  PieChart,
  MapPin,
  Cpu,
  Activity,
  TrendingUp,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { AthenaReconciliationSummary } from '../types';

interface AthenaTrendAndBreakdownProps {
  summary: AthenaReconciliationSummary;
  onSelectReason?: (reason: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function AthenaTrendAndBreakdown({
  summary,
  onSelectReason,
  isCollapsed = false,
  onToggleCollapse,
}: AthenaTrendAndBreakdownProps) {
  const [timeframe, setTimeframe] = useState<'7d' | '14d' | '30d' | 'all'>('30d');
  const [chartType, setChartType] = useState<'areaspline' | 'column'>('areaspline');
  const [activeTab, setActiveTab] = useState<'reasons' | 'serials' | 'outlets'>('reasons');

  const [isDark, setIsDark] = useState<boolean>(false);

  React.useEffect(() => {
    const checkDark = () => {
      const isDarkMode = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
      setIsDark(isDarkMode);
    };
    checkDark();

    const observer = new MutationObserver(checkDark);
    if (typeof document !== 'undefined') {
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }
    return () => observer.disconnect();
  }, []);

  // Filter daily trend based on selected timeframe
  const chartData = useMemo(() => {
    const data = summary.dailyTrend;
    let filtered = data;
    if (timeframe === '7d') filtered = data.slice(-7);
    else if (timeframe === '14d') filtered = data.slice(-14);
    else if (timeframe === '30d') filtered = data.slice(-30);

    return filtered.map((item) => ({
      date: item.date,
      displayDate: item.date.slice(5),
      total: item.total,
      registered: item.registered,
      notRegistered: item.notRegistered,
      recoveryRatePct:
        item.total > 0 ? Number(((item.registered / item.total) * 100).toFixed(1)) : 0,
    }));
  }, [summary.dailyTrend, timeframe]);

  // Overall calculations for KPI snapshot
  const stats = useMemo(() => {
    const total = chartData.reduce((a, d) => a + d.total, 0);
    const registered = chartData.reduce((a, d) => a + d.registered, 0);
    const notRegistered = chartData.reduce((a, d) => a + d.notRegistered, 0);
    const rate = total > 0 ? Number(((registered / total) * 100).toFixed(1)) : 0;
    const peak = chartData.reduce(
      (prev, curr) => (curr.total > (prev?.total || 0) ? curr : prev),
      chartData[0]
    );
    return { total, registered, notRegistered, rate, peak };
  }, [chartData]);

  // Highcharts Configuration Options
  const highchartsOptions: Highcharts.Options = useMemo(() => {
    const categories = chartData.map((d) => d.displayDate);
    const registeredData = chartData.map((d) => d.registered);
    const notRegisteredData = chartData.map((d) => d.notRegistered);

    return {
      chart: {
        type: chartType,
        backgroundColor: 'transparent',
        height: 195,
        style: {
          fontFamily: 'inherit',
        },
        spacing: [5, 5, 5, 5],
      },
      title: {
        text: undefined,
      },
      credits: {
        enabled: false,
      },
      xAxis: {
        categories,
        lineColor: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(226, 232, 240, 0.9)',
        tickColor: isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(226, 232, 240, 0.9)',
        labels: {
          style: {
            color: '#94a3b8',
            fontSize: '9px',
            fontFamily: 'monospace',
          },
          step: chartData.length > 15 ? Math.ceil(chartData.length / 10) : 1,
        },
        crosshair: {
          width: 1,
          color: '#3b82f6',
          dashStyle: 'Dash',
        },
      },
      yAxis: {
        title: {
          text: undefined,
        },
        min: 0,
        gridLineColor: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(241, 245, 249, 0.9)',
        gridLineDashStyle: 'Dash',
        labels: {
          style: {
            color: '#94a3b8',
            fontSize: '9px',
            fontFamily: 'monospace',
          },
        },
      },
      plotOptions: {
        areaspline: {
          fillOpacity: 0.25,
          lineWidth: 2,
          marker: {
            radius: 2,
            symbol: 'circle',
            states: {
              hover: {
                radius: 3.5,
                lineWidth: 1.5,
              },
            },
          },
        },
        column: {
          stacking: 'normal',
          borderRadius: 2,
          borderWidth: 0,
          maxPointWidth: 22,
        },
        series: {
          animation: {
            duration: 300,
          },
        },
      },
      tooltip: {
        shared: true,
        useHTML: true,
        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : '#ffffff',
        borderColor: isDark ? 'rgba(51, 65, 85, 0.8)' : '#e2e8f0',
        borderRadius: 8,
        shadow: {
          color: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.08)',
          offsetX: 0,
          offsetY: 2,
          opacity: 0.12,
          width: 5,
        },
        style: {
          color: isDark ? '#ffffff' : '#0f172a',
          fontSize: '11px',
        },
        formatter: function () {
          const point = this.points?.[0] as (Highcharts.Point & { index?: number }) | undefined;
          const index = point?.index ?? 0;
          const pointMeta = chartData[index];
          if (!pointMeta) return '';

          const reg = pointMeta.registered;
          const unreg = pointMeta.notRegistered;
          const tot = pointMeta.total;
          const rate = pointMeta.recoveryRatePct;

          if (isDark) {
            return `
              <div style="padding: 3px 5px; min-width: 140px;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 3px; margin-bottom: 3px;">
                  <span style="font-weight: 700; font-size: 10px; color: #f8fafc;">${pointMeta.date}</span>
                  <span style="background: rgba(15, 118, 110, 0.3); color: #2dd4bf; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 9999px;">
                    ${rate}%
                  </span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px;">
                  <span style="color: #94a3b8;">Total:</span>
                  <strong style="color: #ffffff;">${tot.toLocaleString()}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; color: #2dd4bf;">
                  <span>● Resolved:</span>
                  <strong style="color: #2dd4bf;">${reg.toLocaleString()}</strong>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 10px; color: #fb7185;">
                  <span>● Unresolved:</span>
                  <strong style="color: #fb7185;">${unreg.toLocaleString()}</strong>
                </div>
              </div>
            `;
          }

          return `
            <div style="padding: 3px 5px; min-width: 140px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 3px; margin-bottom: 3px;">
                <span style="font-weight: 700; font-size: 10px; color: #0f172a;">${pointMeta.date}</span>
                <span style="background: #ecfdf5; color: #0f766e; font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 9999px; border: 1px solid #a7f3d0;">
                  ${rate}%
                </span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px;">
                <span style="color: #64748b;">Total:</span>
                <strong style="color: #0f172a;">${tot.toLocaleString()}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px; color: #0f766e;">
                <span>● Resolved:</span>
                <strong style="color: #0f766e;">${reg.toLocaleString()}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 10px; color: #be123c;">
                <span>● Unresolved:</span>
                <strong style="color: #be123c;">${unreg.toLocaleString()}</strong>
              </div>
            </div>
          `;
        },
      },
      legend: {
        enabled: true,
        align: 'center',
        verticalAlign: 'bottom',
        itemStyle: {
          color: '#64748b',
          fontSize: '9px',
          fontWeight: '500',
        },
        itemHoverStyle: {
          color: '#0f172a',
        },
      },
      series: [
        {
          name: 'Resolved in CRM',
          type: chartType,
          color: '#0f766e',
          data: registeredData,
          ...(chartType === 'areaspline'
            ? {
                fillColor: {
                  linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                  stops: [
                    [0, 'rgba(15, 118, 110, 0.35)'],
                    [1, 'rgba(15, 118, 110, 0.02)'],
                  ],
                },
              }
            : {}),
        },
        {
          name: 'Unregistered Net Failures',
          type: chartType,
          color: '#be123c',
          data: notRegisteredData,
          ...(chartType === 'areaspline'
            ? {
                fillColor: {
                  linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                  stops: [
                    [0, 'rgba(190, 18, 60, 0.35)'],
                    [1, 'rgba(190, 18, 60, 0.02)'],
                  ],
                },
              }
            : {}),
        },
      ],
    };
  }, [chartData, chartType]);

  if (isCollapsed) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span>Visual Analytics & Insights (Collapsed)</span>
          <span className="rounded-full bg-teal-50 px-1.5 py-0.2 text-[9px] font-bold text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
            {stats.rate}% Recovered
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          <span>Expand Analytics</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12 w-full">
      {/* 1. Highcharts Interactive Daily Trend (7 cols) */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-7 flex flex-col justify-between">
        <div>
          {/* Card Header & Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1.5 dark:border-slate-800">
            <div className="flex items-center gap-1.5">
              <div className="rounded bg-blue-50 p-1 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                <Activity className="h-3 w-3" />
              </div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                Daily Failure & Recovery Trend
              </h3>
              <span className="rounded-full bg-teal-50 px-1.5 py-0.1 text-[9px] font-bold text-teal-700 dark:bg-teal-950/50 dark:text-teal-400 border border-teal-200/50">
                {stats.rate}% Recovered
              </span>
            </div>

            {/* Timeframe & Chart Style Switcher */}
            <div className="flex items-center gap-1">
              {/* Spline vs Column Toggle */}
              <div className="flex items-center rounded bg-slate-100 p-0.5 text-[10px] font-semibold dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setChartType('areaspline')}
                  className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 transition-all ${
                    chartType === 'areaspline'
                      ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-blue-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  <TrendingUp className="h-2.5 w-2.5" /> Spline
                </button>
                <button
                  type="button"
                  onClick={() => setChartType('column')}
                  className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 transition-all ${
                    chartType === 'column'
                      ? 'bg-white text-blue-600 shadow-2xs dark:bg-slate-700 dark:text-blue-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  <BarChart3 className="h-2.5 w-2.5" /> Columns
                </button>
              </div>

              {/* Timeframe switcher */}
              <div className="flex items-center rounded bg-slate-100 p-0.5 text-[10px] font-medium dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setTimeframe('7d')}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    timeframe === '7d'
                      ? 'bg-white font-bold text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  7D
                </button>
                <button
                  type="button"
                  onClick={() => setTimeframe('14d')}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    timeframe === '14d'
                      ? 'bg-white font-bold text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  14D
                </button>
                <button
                  type="button"
                  onClick={() => setTimeframe('30d')}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    timeframe === '30d'
                      ? 'bg-white font-bold text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  30D
                </button>
                <button
                  type="button"
                  onClick={() => setTimeframe('all')}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    timeframe === 'all'
                      ? 'bg-white font-bold text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                  }`}
                >
                  All
                </button>
              </div>

              {onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  title="Collapse analytics"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Highcharts Component */}
        {chartData.length === 0 ? (
          <div className="flex h-36 items-center justify-center text-xs text-slate-400">
            No daily trend data available for active scope
          </div>
        ) : (
          <div className="mt-1 w-full">
            <HighchartsReact highcharts={Highcharts} options={highchartsOptions} />
          </div>
        )}
      </div>

      {/* 2. Right Tabbed Diagnostics Panel: Reasons / Serials / Outlets (5 cols) */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-5 flex flex-col justify-between">
        <div>
          {/* Header Tabs */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 dark:border-slate-800">
            <div className="flex items-center gap-1 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('reasons')}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                  activeTab === 'reasons'
                    ? 'bg-purple-50 text-purple-700 font-bold dark:bg-purple-950/50 dark:text-purple-300 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <PieChart className="h-3 w-3" />
                <span>Reasons</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('serials')}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                  activeTab === 'serials'
                    ? 'bg-amber-50 text-amber-700 font-bold dark:bg-amber-950/50 dark:text-amber-300 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <Cpu className="h-3 w-3" />
                <span>Serials</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('outlets')}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors ${
                  activeTab === 'outlets'
                    ? 'bg-teal-50 text-teal-700 font-bold dark:bg-teal-950/50 dark:text-teal-300 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                }`}
              >
                <MapPin className="h-3 w-3" />
                <span>Outlets</span>
              </button>
            </div>

            <span className="text-[10px] text-slate-400">
              {activeTab === 'reasons' ? 'Click to filter' : 'Unregistered'}
            </span>
          </div>

          {/* Tab Content */}
          <div className="mt-1.5 space-y-1 max-h-[195px] overflow-y-auto pr-1 custom-scrollbar">
            {activeTab === 'reasons' && (
              summary.byFailureReason.length === 0 ? (
                <div className="flex h-36 items-center justify-center text-xs text-slate-400">
                  No failure reasons recorded
                </div>
              ) : (
                summary.byFailureReason.slice(0, 8).map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => onSelectReason?.(item.label)}
                    className="w-full text-left group transition-all rounded p-1 hover:bg-purple-50/70 dark:hover:bg-purple-950/30 border border-slate-100/80 hover:border-purple-200 dark:border-slate-800/80"
                  >
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[180px] group-hover:text-purple-700 dark:group-hover:text-purple-300">
                        {item.label}
                      </span>
                      <span className="font-bold text-slate-900 dark:text-white shrink-0 ml-1">
                        {item.count.toLocaleString()}{' '}
                        <span className="text-[9px] font-normal text-slate-400">
                          ({item.percentage}%)
                        </span>
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-600 transition-all duration-300"
                        style={{ width: `${Math.min(100, item.percentage)}%` }}
                      />
                    </div>
                  </button>
                ))
              )
            )}

            {activeTab === 'serials' && (
              summary.topUnregisteredSerials.length === 0 ? (
                <div className="flex h-36 items-center justify-center text-xs text-slate-400">
                  No repeated problem serials
                </div>
              ) : (
                summary.topUnregisteredSerials.map((s) => (
                  <div key={s.identifier} className="flex items-center justify-between py-1 px-1 border-b border-slate-50 dark:border-slate-850 text-xs">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100 font-mono text-[11px]">
                        {s.name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                        {s.commonFailureReason || '-'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center rounded bg-rose-50 px-1.5 py-0.2 text-[10px] font-bold text-rose-700 border border-rose-200/60 dark:bg-rose-950/50 dark:text-rose-300">
                        {s.totalUnregistered} failed
                      </span>
                    </div>
                  </div>
                ))
              )
            )}

            {activeTab === 'outlets' && (
              summary.topUnregisteredOutlets.length === 0 ? (
                <div className="flex h-36 items-center justify-center text-xs text-slate-400">
                  No repeated problem outlets
                </div>
              ) : (
                summary.topUnregisteredOutlets.map((o) => (
                  <div key={o.identifier} className="flex items-center justify-between py-1 px-1 border-b border-slate-50 dark:border-slate-850 text-xs">
                    <div className="max-w-[190px] truncate">
                      <div className="font-bold text-slate-900 dark:text-slate-100 truncate text-[11px]">
                        {o.name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {o.commonFailureReason || '-'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center rounded bg-rose-50 px-1.5 py-0.2 text-[10px] font-bold text-rose-700 border border-rose-200/60 dark:bg-rose-950/50 dark:text-rose-300">
                        {o.totalUnregistered} failed
                      </span>
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-1 text-[10px] text-slate-400 flex items-center justify-between dark:border-slate-800">
          <span>
            {activeTab === 'reasons' && `${summary.byFailureReason.length} Pattern Categories`}
            {activeTab === 'serials' && `${summary.topUnregisteredSerials.length} Problem Serials`}
            {activeTab === 'outlets' && `${summary.topUnregisteredOutlets.length} Problem Outlets`}
          </span>
          <span className="text-blue-600 dark:text-blue-400 font-medium">Live Analytics</span>
        </div>
      </div>
    </div>
  );
}
