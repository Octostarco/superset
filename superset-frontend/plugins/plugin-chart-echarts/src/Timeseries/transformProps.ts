/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
/* eslint-disable camelcase */
import {
  AnnotationLayer,
  CategoricalColorNamespace,
  GenericDataType,
  getNumberFormatter,
  isEventAnnotationLayer,
  isFormulaAnnotationLayer,
  isIntervalAnnotationLayer,
  isTimeseriesAnnotationLayer,
  TimeseriesChartDataResponseResult,
  t,
  AxisType,
  getXAxisLabel,
  isPhysicalColumn,
  isDefined,
} from '@superset-ui/core';
import { isDerivedSeries } from '@superset-ui/chart-controls';
import { EChartsCoreOption, SeriesOption } from 'echarts';
import { ZRLineType } from 'echarts/types/src/util/types';
import {
  EchartsTimeseriesChartProps,
  EchartsTimeseriesFormData,
  EchartsTimeseriesSeriesType,
  TimeseriesChartTransformedProps,
  OrientationType,
} from './types';
import { DEFAULT_FORM_DATA } from './constants';
import { ForecastSeriesEnum, ForecastValue, Refs } from '../types';
import { parseYAxisBound } from '../utils/controls';
import {
  currentSeries,
  dedupSeries,
  extractSeries,
  getAxisType,
  getColtypesMapping,
  getLegendProps,
  extractDataTotalValues,
  extractShowValueIndexes,
} from '../utils/series';
import {
  extractAnnotationLabels,
  getAnnotationData,
} from '../utils/annotation';
import {
  extractForecastSeriesContext,
  extractForecastSeriesContexts,
  extractForecastValuesFromTooltipParams,
  formatForecastTooltipSeries,
  rebaseForecastDatum,
} from '../utils/forecast';
import { convertInteger } from '../utils/convertInteger';
import { defaultGrid, defaultYAxis } from '../defaults';
import {
  getPadding,
  getTooltipTimeFormatter,
  getXAxisFormatter,
  transformEventAnnotation,
  transformFormulaAnnotation,
  transformIntervalAnnotation,
  transformSeries,
  transformTimeseriesAnnotation,
} from './transformers';
import {
  AreaChartExtraControlsValue,
  TIMESERIES_CONSTANTS,
  TIMEGRAIN_TO_TIMESTAMP,
} from '../constants';
import { getDefaultTooltip } from '../utils/tooltip';

export default function transformProps(
  chartProps: EchartsTimeseriesChartProps,
): TimeseriesChartTransformedProps {
  const {
    width,
    height,
    filterState,
    formData,
    hooks,
    queriesData,
    datasource,
    theme,
    inContextMenu,
  } = chartProps;
  const { verboseMap = {} } = datasource;
  const [queryData] = queriesData;
  const { data = [], label_map: labelMap } =
    queryData as TimeseriesChartDataResponseResult;
  const dataTypes = getColtypesMapping(queryData);
  const annotationData = getAnnotationData(chartProps);

  const {
    area,
    annotationLayers,
    colorScheme,
    contributionMode,
    forecastEnabled,
    legendOrientation,
    legendType,
    legendMargin,
    logAxis,
    markerEnabled,
    markerSize,
    opacity,
    minorSplitLine,
    seriesType,
    showLegend,
    stack,
    truncateYAxis,
    yAxisFormat,
    xAxisTimeFormat,
    yAxisBounds,
    tooltipTimeFormat,
    tooltipSortByMetric,
    zoomable,
    richTooltip,
    xAxis: xAxisOrig,
    xAxisLabelRotation,
    emitFilter,
    groupby,
    showValue,
    onlyTotal,
    percentageThreshold,
    xAxisTitle,
    yAxisTitle,
    xAxisTitleMargin,
    yAxisTitleMargin,
    yAxisTitlePosition,
    sliceId,
    timeGrainSqla,
    orientation,
  }: EchartsTimeseriesFormData = { ...DEFAULT_FORM_DATA, ...formData };
  const refs: Refs = {};

  const colorScale = CategoricalColorNamespace.getScale(colorScheme as string);
  const rebasedData = rebaseForecastDatum(data, verboseMap);
  let xAxisLabel = getXAxisLabel(chartProps.rawFormData) as string;
  if (
    isPhysicalColumn(chartProps.rawFormData?.x_axis) &&
    isDefined(verboseMap[xAxisLabel])
  ) {
    xAxisLabel = verboseMap[xAxisLabel];
  }
  const isHorizontal = orientation === OrientationType.horizontal;
  const { totalStackedValues, thresholdValues } = extractDataTotalValues(
    rebasedData,
    {
      stack,
      percentageThreshold,
      xAxisCol: xAxisLabel,
    },
  );
  const rawSeries = extractSeries(rebasedData, {
    fillNeighborValue: stack && !forecastEnabled ? 0 : undefined,
    xAxis: xAxisLabel,
    removeNulls: seriesType === EchartsTimeseriesSeriesType.Scatter,
    stack,
    totalStackedValues,
    isHorizontal,
  });
  const showValueIndexes = extractShowValueIndexes(rawSeries, {
    stack,
    onlyTotal,
    isHorizontal,
  });
  const seriesContexts = extractForecastSeriesContexts(
    Object.values(rawSeries).map(series => series.name as string),
  );
  const isAreaExpand = stack === AreaChartExtraControlsValue.Expand;
  const xAxisDataType = dataTypes?.[xAxisLabel] ?? dataTypes?.[xAxisOrig];

  const xAxisType = getAxisType(xAxisDataType);
  const series: SeriesOption[] = [];
  const formatter = getNumberFormatter(
    contributionMode || isAreaExpand ? ',.0%' : yAxisFormat,
  );

  rawSeries.forEach(entry => {
    const lineStyle = isDerivedSeries(entry, chartProps.rawFormData)
      ? { type: 'dashed' as ZRLineType }
      : {};
    const transformedSeries = transformSeries(entry, colorScale, {
      area,
      filterState,
      seriesContexts,
      markerEnabled,
      markerSize,
      areaOpacity: opacity,
      seriesType,
      stack,
      formatter,
      showValue,
      onlyTotal,
      totalStackedValues,
      showValueIndexes,
      thresholdValues,
      richTooltip,
      sliceId,
      isHorizontal,
      lineStyle,
    });
    if (transformedSeries) series.push(transformedSeries);
  });

  const selectedValues = (filterState.selectedValues || []).reduce(
    (acc: Record<string, number>, selectedValue: string) => {
      const index = series.findIndex(({ name }) => name === selectedValue);
      return {
        ...acc,
        [index]: selectedValue,
      };
    },
    {},
  );

  annotationLayers
    .filter((layer: AnnotationLayer) => layer.show)
    .forEach((layer: AnnotationLayer) => {
      if (isFormulaAnnotationLayer(layer))
        series.push(
          transformFormulaAnnotation(
            layer,
            data,
            xAxisLabel,
            xAxisType,
            colorScale,
            sliceId,
          ),
        );
      else if (isIntervalAnnotationLayer(layer)) {
        series.push(
          ...transformIntervalAnnotation(
            layer,
            data,
            annotationData,
            colorScale,
            theme,
            sliceId,
          ),
        );
      } else if (isEventAnnotationLayer(layer)) {
        series.push(
          ...transformEventAnnotation(
            layer,
            data,
            annotationData,
            colorScale,
            theme,
            sliceId,
          ),
        );
      } else if (isTimeseriesAnnotationLayer(layer)) {
        series.push(
          ...transformTimeseriesAnnotation(
            layer,
            markerSize,
            data,
            annotationData,
            colorScale,
            sliceId,
          ),
        );
      }
    });

  // yAxisBounds need to be parsed to replace incompatible values with undefined
  let [min, max] = (yAxisBounds || []).map(parseYAxisBound);

  // default to 0-100% range when doing row-level contribution chart
  if ((contributionMode === 'row' || isAreaExpand) && stack) {
    if (min === undefined) min = 0;
    if (max === undefined) max = 1;
  }

  const tooltipFormatter =
    xAxisDataType === GenericDataType.TEMPORAL
      ? getTooltipTimeFormatter(tooltipTimeFormat)
      : String;
  const xAxisFormatter =
    xAxisDataType === GenericDataType.TEMPORAL
      ? getXAxisFormatter(xAxisTimeFormat)
      : String;

  const {
    setDataMask = () => {},
    setControlValue = () => {},
    onContextMenu,
  } = hooks;

  const addYAxisLabelOffset = !!yAxisTitle;
  const addXAxisLabelOffset = !!xAxisTitle;
  const padding = getPadding(
    showLegend,
    legendOrientation,
    addYAxisLabelOffset,
    zoomable,
    legendMargin,
    addXAxisLabelOffset,
    yAxisTitlePosition,
    convertInteger(yAxisTitleMargin),
    convertInteger(xAxisTitleMargin),
  );

  const legendData = rawSeries
    .filter(
      entry =>
        extractForecastSeriesContext(entry.name || '').type ===
        ForecastSeriesEnum.Observation,
    )
    .map(entry => entry.name || '')
    .concat(extractAnnotationLabels(annotationLayers, annotationData));

  let xAxis: any = {
    type: xAxisType,
    name: xAxisTitle,
    nameGap: convertInteger(xAxisTitleMargin),
    nameLocation: 'middle',
    axisLabel: {
      hideOverlap: true,
      formatter: xAxisFormatter,
      rotate: xAxisLabelRotation,
    },
    minInterval:
      xAxisType === AxisType.time && timeGrainSqla
        ? TIMEGRAIN_TO_TIMESTAMP[timeGrainSqla]
        : 0,
  };

  if (xAxisType === AxisType.time) {
    /**
     * Overriding default behavior (false) for time axis regardless of the granilarity.
     * Not including this in the initial declaration above so if echarts changes the default
     * behavior for other axist types we won't unintentionally override it
     */
    xAxis.axisLabel.showMaxLabel = null;
  }

  let yAxis: any = {
    ...defaultYAxis,
    type: logAxis ? AxisType.log : AxisType.value,
    min,
    max,
    minorTick: { show: true },
    minorSplitLine: { show: minorSplitLine },
    axisLabel: { formatter },
    scale: truncateYAxis,
    name: yAxisTitle,
    nameGap: convertInteger(yAxisTitleMargin),
    nameLocation: yAxisTitlePosition === 'Left' ? 'middle' : 'end',
  };

  if (isHorizontal) {
    [xAxis, yAxis] = [yAxis, xAxis];
    [padding.bottom, padding.left] = [padding.left, padding.bottom];
  }

  const echartOptions: EChartsCoreOption = {
    useUTC: true,
    grid: {
      ...defaultGrid,
      ...padding,
    },
    xAxis,
    yAxis,
    tooltip: {
      ...getDefaultTooltip(refs),
      show: !inContextMenu,
      trigger: richTooltip ? 'axis' : 'item',
      formatter: (params: any) => {
        const [xIndex, yIndex] = isHorizontal ? [1, 0] : [0, 1];
        const xValue: number = richTooltip
          ? params[0].value[xIndex]
          : params.value[xIndex];
        const forecastValue: any[] = richTooltip ? params : [params];

        if (richTooltip && tooltipSortByMetric) {
          forecastValue.sort((a, b) => b.data[yIndex] - a.data[yIndex]);
        }

        const rows: Array<string> = [`${tooltipFormatter(xValue)}`];
        const forecastValues: Record<string, ForecastValue> =
          extractForecastValuesFromTooltipParams(forecastValue, isHorizontal);

        Object.keys(forecastValues).forEach(key => {
          const value = forecastValues[key];
          const content = formatForecastTooltipSeries({
            ...value,
            seriesName: key,
            formatter,
          });
          if (currentSeries.name === key) {
            rows.push(`<span style="font-weight: 700">${content}</span>`);
          } else {
            rows.push(`<span style="opacity: 0.7">${content}</span>`);
          }
        });
        return rows.join('<br />');
      },
    },
    legend: {
      ...getLegendProps(legendType, legendOrientation, showLegend, zoomable),
      data: legendData as string[],
    },
    series: dedupSeries(series),
    toolbox: {
      show: zoomable,
      top: TIMESERIES_CONSTANTS.toolboxTop,
      right: TIMESERIES_CONSTANTS.toolboxRight,
      feature: {
        dataZoom: {
          yAxisIndex: false,
          title: {
            zoom: t('zoom area'),
            back: t('restore zoom'),
          },
        },
        myEmitTimeFilter: {
          show: zoomable && emitFilter,
          title: 'Apply Time Filter',
          icon: 'path://M9.59961 17.8C9.59961 18.3523 10.0473 18.8 10.5996 18.8H13.3996C13.9519 18.8 14.3996 18.3523 14.3996 17.8V17.8C14.3996 17.2477 13.9519 16.8 13.3996 16.8H10.5996C10.0473 16.8 9.59961 17.2477 9.59961 17.8V17.8ZM2.59961 4C2.04732 4 1.59961 4.44772 1.59961 5V5C1.59961 5.55228 2.04732 6 2.59961 6H21.3996C21.9519 6 22.3996 5.55228 22.3996 5V5C22.3996 4.44772 21.9519 4 21.3996 4H2.59961ZM6.39961 11.4C6.39961 11.9523 6.84732 12.4 7.39961 12.4H16.5996C17.1519 12.4 17.5996 11.9523 17.5996 11.4V11.4C17.5996 10.8477 17.1519 10.4 16.5996 10.4H7.39961C6.84732 10.4 6.39961 10.8477 6.39961 11.4V11.4Z',
          onclick(model: {
            option: { dataZoom: { startValue: any; endValue: any }[] };
          }) {
            const zoom = model?.option?.dataZoom;
            const startValue = zoom?.[0]?.startValue;
            const endValue = zoom?.[0]?.endValue;

            if (startValue !== undefined && endValue !== undefined) {
              const from = new Date(startValue).toISOString().substring(0, 19);
              // add 1 second to end value so not to exclude that
              // since the filter is done:  >= start and < end
              const until = new Date(endValue + 1000)
                .toISOString()
                .substring(0, 19);

              const time_range = `${from} : ${until}`;
              const dataMask = {
                extraFormData: {
                  time_range,
                },
                filterState: {
                  label: ['Time range'],
                  value: time_range,
                  selectedValues: [time_range],
                },
              };
              setDataMask(dataMask);
            }
          },
        },
      },
    },
    dataZoom: zoomable
      ? [
          {
            type: 'slider',
            start: TIMESERIES_CONSTANTS.dataZoomStart,
            end: TIMESERIES_CONSTANTS.dataZoomEnd,
            bottom: TIMESERIES_CONSTANTS.zoomBottom,
          },
        ]
      : [],
  };

  return {
    echartOptions,
    emitFilter,
    formData,
    groupby,
    height,
    labelMap,
    selectedValues,
    setDataMask,
    setControlValue,
    width,
    legendData,
    onContextMenu,
    xValueFormatter: tooltipFormatter,
    xAxis: {
      label: xAxisLabel,
      type: xAxisType,
    },
    refs,
  };
}
