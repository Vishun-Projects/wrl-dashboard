'use client';

import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format: { [k in string]: { label?: React.ReactNode; icon?: React.ComponentType; color?: string; theme?: Record<string, string> } }
export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
    theme?: Record<string, string>;
  };
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & {
    config: ChartConfig;
    children: React.ReactNode;
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted/30 [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children as any}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = 'Chart';

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, itemConfig]) => itemConfig.theme || itemConfig.color
  );

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(config)
          .map(([key, itemConfig]) => {
            const color = itemConfig.color;
            return color ? `[data-chart=${id}] { --color-${key}: ${color}; }` : '';
          })
          .join('\n'),
      }}
    />
  );
};

export const ChartTooltip = RechartsPrimitive.Tooltip;

export interface ChartTooltipContentProps extends React.ComponentProps<'div'> {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: any;
    dataKey?: string | number;
    color?: string;
    payload?: any;
    fill?: string;
    [key: string]: any;
  }>;
  label?: any;
  labelFormatter?: (label: any, payload: any[]) => React.ReactNode;
  labelClassName?: string;
  formatter?: (
    value: any,
    name: any,
    item: any,
    index: number,
    payload: any
  ) => React.ReactNode;
  color?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: 'line' | 'dot' | 'dashed';
  nameKey?: string;
  labelKey?: string;
}

export const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  ChartTooltipContentProps
>(
  (
    {
      active,
      payload,
      className,
      indicator = 'dot',
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
    },
    ref
  ) => {
    const { config } = useChart();

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null;
      }

      const [item] = payload;
      const key = `${labelKey || item?.dataKey || item?.name || 'value'}`;
      const itemConfig = getPayloadConfigFromPayload(config, item, key);
      const value =
        !labelKey && typeof label === 'string'
          ? config[label as keyof typeof config]?.label || label
          : itemConfig?.label;

      if (labelFormatter) {
        return (
          <div className={cn('font-medium', labelClassName)}>
            {labelFormatter(value, payload)}
          </div>
        );
      }

      if (!value) {
        return null;
      }

      return (
        <div className={cn('font-semibold text-slate-900 dark:text-white', labelClassName)}>
          {value}
        </div>
      );
    }, [
      label,
      labelFormatter,
      payload,
      hideLabel,
      labelClassName,
      config,
      labelKey,
    ]);

    if (!active || !payload?.length) {
      return null;
    }

    const nestLabel = payload.length === 1 && indicator !== 'dot';

    return (
      <div
        ref={ref}
        className={cn(
          'grid min-w-[9rem] items-start gap-1.5 rounded-xl border border-slate-200/80 bg-white/95 p-3 text-xs shadow-xl backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95',
          className
        )}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload.map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color || item.payload?.fill || item.color;

            return (
              <div
                key={item.dataKey || index}
                className={cn(
                  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
                  indicator === 'dot' && 'items-center'
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            'shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)',
                            {
                              'h-2.5 w-2.5 rounded-full': indicator === 'dot',
                              'w-1': indicator === 'line',
                              'w-0 border-[1.5px] border-dashed bg-transparent':
                                indicator === 'dashed',
                              'my-0.5': nestLabel && indicator === 'dashed',
                            }
                          )}
                          style={
                            {
                              '--color-bg': indicatorColor,
                              '--color-border': indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        'flex flex-1 justify-between leading-none',
                        nestLabel ? 'items-end' : 'items-center'
                      )}
                    >
                      <div className="grid gap-0.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-slate-500 dark:text-slate-400 font-medium">
                          {itemConfig?.label || item.name}
                        </span>
                      </div>
                      {item.value !== undefined && (
                        <span className="font-bold text-slate-900 dark:text-white tabular-nums ml-2">
                          {typeof item.value === 'number'
                            ? item.value.toLocaleString()
                            : item.value}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
ChartTooltipContent.displayName = 'ChartTooltip';

export const ChartLegend = RechartsPrimitive.Legend;

export interface ChartLegendContentProps extends React.ComponentProps<'div'> {
  payload?: Array<{
    value?: any;
    color?: string;
    dataKey?: string | number;
    [key: string]: any;
  }>;
  verticalAlign?: 'top' | 'bottom' | 'middle';
  hideIcon?: boolean;
  nameKey?: string;
}

export const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  ChartLegendContentProps
>(
  (
    { className, hideIcon = false, payload, verticalAlign = 'bottom', nameKey },
    ref
  ) => {
    const { config } = useChart();

    if (!payload?.length) {
      return null;
    }

    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center justify-center gap-4 text-xs font-medium',
          verticalAlign === 'top' ? 'pb-3' : 'pt-3',
          className
        )}
      >
        {payload.map((item) => {
          const key = `${nameKey || item.dataKey || 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div
              key={item.value}
              className={cn(
                'flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground'
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              <span className="text-slate-600 dark:text-slate-300">
                {itemConfig?.label || item.value}
              </span>
            </div>
          );
        })}
      </div>
    );
  }
);
ChartLegendContent.displayName = 'ChartLegend';

// Helper to extract item config from a payload
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const payloadPayload =
    'payload' in payload &&
    typeof payload.payload === 'object' &&
    payload.payload !== null
      ? (payload.payload as Record<string, unknown>)
      : undefined;

  let configLabelKey: string = key;

  if (
    key in payload &&
    typeof (payload as Record<string, unknown>)[key] === 'string'
  ) {
    configLabelKey = (payload as Record<string, unknown>)[key] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key] === 'string'
  ) {
    configLabelKey = payloadPayload[key] as string;
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config];
}
