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
}
