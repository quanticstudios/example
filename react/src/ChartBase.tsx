import { zoom, select, ZoomTransform, zoomIdentity, ZoomBehavior } from "d3";

import {
  differenceInHours,
  format,
  getDate,
  getYear,
  startOfDay,
  isSameDay,
} from "date-fns";
import { zonedTimeToUtc } from "date-fns-tz";
import inRange from "lodash/inRange";
import uniqBy from "lodash/uniqBy";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSetRecoilState } from "recoil";
import styled, { css } from "styled-components";

import { RangeSlider } from "@ui/Slider";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { localPoint } from "@visx/event";
import { GridColumns, GridRows } from "@visx/grid";
import withParentSize, {
  WithParentSizeProps,
  WithParentSizeProvidedProps,
} from "@visx/responsive/lib/enhancers/withParentSizeModern";
import { scaleLinear, scaleTime } from "@visx/scale";
import { TooltipWithBounds, useTooltip } from "@visx/tooltip";

import { ThemeMode } from "@src/config/theme";
import { useChartContextDateRange, useChartContextRealtime } from "@src/contexts/charts";
import useDateRangeController from "@src/hooks/useDateRangeController";
import useZoom from "@src/hooks/useZoom";
import useUpdateUserMeta from "@src/hooks/user/useUpdateUserMeta";
import { chartZoomedState } from "@src/recoil/chart";
import { colors } from "@src/theme/config/colors";
import { AreaSeries, GraphId, LineSeries, Point, TooltipData } from "@src/types/collections";
import { convertToUTC } from "@src/utils/date";

import { CrosshairProvider, useSetCrosshairPoint } from "./contexts/Crosshair";
import AreaGraph from "./elements/AreaGraph";
import Crosshair from "./elements/Crosshair";
import LineGraph from "./elements/LineGraph";
import { getGraphsMax } from "./utils/getGraphsMax";
import { getAreaSeries } from "./utils/getAreaSeries";

const lineOrder = [
  GraphId.GAS_OUTLET_VOLUME,
  GraphId.GAS_INLET_VOLUME,
  GraphId.OIL_OUTLET_VOLUME,
  GraphId.OIL_INLET_VOLUME,
  GraphId.WATER_OUTLET_VOLUME,
  GraphId.WATER_INLET_VOLUME,
];

const Wrapper = styled.div`
  height: 100%;
  position: relative;

  & .visx-axis-tick {
    color: red;
  }
`;

const VerticalSlider = styled(RangeSlider).attrs({ orientation: "vertical" })`
  position: absolute;
  left: 0;
  top: 20px;
  height: calc(100% - 90px);
`;

const HorizontalSlider = styled(RangeSlider).attrs({ orientation: "horizontal" })`
  position: absolute;
  bottom: 0;
  right: 20px;
  width: calc(100% - 105px);
`;

const GraphWrapper = styled.div`
  position: relative;
`;

const Svg = styled.svg`
  vertical-align: bottom;
`;

const Tooltip = styled(TooltipWithBounds)`
  background: #353a4b !important;
  ${({ theme }) => css`
    border-radius: ${theme.radius(8)} !important;
    color: ${theme.color("white")} !important;
    font-size: ${theme.fontSize(10)};
    padding: ${theme.spacing(4, 8)};
  `}
`;

const TooltipText = styled.p`
  align-items: center;
  display: flex;
  gap: ${({ theme }) => theme.spacing(4)};
  margin: ${({ theme }) => theme.spacing(0, 0, 4)};
  font-size: ${({ theme }) => theme.fontSize(12)};
  &:last-child {
    margin: ${({ theme }) => theme.spacing(0)};
  }
`;

const TooltipLabel = styled.span`
  color: #a8b5d4;
`;

const ColorLabel = styled.span`
  background: #ff0000;
  border-radius: 50%;
  display: inline-flex;
  height: 10px;
  width: 10px;
`;

export type Props = {
  chartId: string;
  series: (LineSeries | AreaSeries)[];
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  size?: "sm";
  width?: number;
  zoomAxis?: "x" | "y";
  resetZoom?: boolean;
  setResetZoom: (shouldReset: boolean) => void;
  showHorizontalSlider?: boolean;
  showVerticalSlider?: boolean;
  colorMode: ThemeMode;
  yAxisRange?: [string, string];
};

const handleTickFormats = (startDate: Date, endDate: Date) => {
  const hoursDifference = differenceInHours(endDate, startDate);
  let largeTickFormat;
  let mediumTickFormat;
  let smallTickFormat;

  switch (true) {
    // less than 1 day - realtime stuff (most likely)
    case hoursDifference < 24:
      largeTickFormat = "HH";
      mediumTickFormat = "mm";
      smallTickFormat = "ss";
      break;
    // less than or equal to two days - most likely historical data for metrics
    // could also be used for actuals and forecasts
    case hoursDifference <= 48:
      largeTickFormat = "MMM";
      mediumTickFormat = "dd";
      smallTickFormat = "HH";
      break;
    // default tick format that we already have in the app
    default:
      largeTickFormat = "yyyy";
      mediumTickFormat = "MM/yyyy";
      smallTickFormat = "dd";
      break;
  }

  return {
    largeTickFormat,
    mediumTickFormat,
    smallTickFormat,
  };
};

const ChartBase = ({
  chartId,
  series,
  height,
  margin = { bottom: 70, left: 60, right: 20, top: 20 },
  parentWidth,
  parentHeight,
  width,
  zoomAxis = "x",
  resetZoom = false,
  setResetZoom,
  showHorizontalSlider,
  showVerticalSlider,
  colorMode,
  yAxisRange,
}: Props & WithParentSizeProvidedProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [currentGlobalZoomState, setCurrentGlobalZoomState] = useState(zoomIdentity);
  const [currentZoomStateX, setCurrentZoomStateX] = useState<ZoomTransform>(currentGlobalZoomState);
  const [currentZoomStateY, setCurrentZoomStateY] = useState<ZoomTransform>(currentGlobalZoomState);
  const updateUserMeta = useUpdateUserMeta();
  const { dateRange: globalDateRange } = useDateRangeController();
  const [customDateRange] = useChartContextDateRange();
  const [isMetrics] = useChartContextRealtime();
  const setIsChartZoomed = useSetRecoilState(chartZoomedState);

  const dateRange = customDateRange ?? globalDateRange;

  const {
    hideTooltip,
    showTooltip,
    tooltipData,
    tooltipLeft = 0,
    tooltipOpen,
    tooltipTop = 0,
  } = useTooltip<TooltipData>();

  const svgWidth = width ?? parentWidth ?? 0;
  const svgHeight = height ?? parentHeight ?? 0;

  const [xZoom, handleXZoom] = useZoom({ key: "scenario-x" });
  const [yZoom, handleYZoom] = useZoom({ key: "scenario-y", minGap: 5 });

  useEffect(() => {
    updateUserMeta({ metaName: "scenario-zoom", values: { xZoom, yZoom } });
  }, [xZoom, yZoom]);

  const lineSeries = useMemo(
    () =>
      (series.filter((graph) => graph.type === "line") as LineSeries[]).sort(
        (line1, line2) => lineOrder.indexOf(line1.id as GraphId) - lineOrder.indexOf(line2.id as GraphId),
      ),
    [series],
  );

  const areaSeries = useMemo(() => getAreaSeries(series), [series]);

  const [minYValue, maxYValue] = useMemo(() => {
    const defaultValue = Math.floor((getGraphsMax([...lineSeries, ...areaSeries]) ?? 0) * 1.1);

    if (!yAxisRange) {
      return [0, defaultValue];
    }

    const [start, end] = yAxisRange;
    const formatStart = start.replace(/\D/g, "");
    const formatEnd = end.replace(/\D/g, "");
    const minYValue = Number(formatStart) || 0;

    const maxYValue = isNaN(Number(formatEnd)) ? defaultValue : Number(formatEnd);

    return [minYValue, maxYValue];
  }, [areaSeries, lineSeries, yAxisRange]);

  const adjustedLeftMargin = useMemo(() => {
    return Math.floor(maxYValue).toString().length * 6 + margin.left;
  }, [margin.left, maxYValue]);

  const innerWidth = svgWidth - adjustedLeftMargin - margin.right;
  const innerHeight = svgHeight - margin.top - margin.bottom;

  const xScale = useMemo(() => {
    const [lower, upper] = xZoom.map((zoomValue) => zoomValue / 100);

    const [minTimestamp, maxTimestamp] = dateRange.map((range) => range.getTime());

    const delta = maxTimestamp - minTimestamp;

    const initialScale = scaleTime({
      domain: [new Date(minTimestamp + lower * delta), new Date(minTimestamp + upper * delta)],
      range: [adjustedLeftMargin, innerWidth + adjustedLeftMargin],
    });

    const newXZoom = currentZoomStateX.rescaleX(initialScale);
    initialScale.domain(newXZoom.domain());

    return initialScale;
  }, [xZoom, dateRange, adjustedLeftMargin, innerWidth, currentZoomStateX, customDateRange]);

  const yScale = useMemo(() => {
    const [lower, upper] = yZoom.map((zoomValue) => zoomValue / 100);
    const yRange = maxYValue - minYValue;

    const initialScale = scaleLinear({
      domain: [lower * yRange + minYValue, maxYValue - (1 - upper) * yRange],
      range: [margin.top + innerHeight, margin.top],
    });

    const newYZoom = currentZoomStateY.rescaleY(initialScale);
    initialScale.domain(newYZoom.domain());

    return initialScale;
  }, [yZoom, maxYValue, minYValue, margin.top, innerHeight, currentZoomStateY]);

  const setCrosshairPoint = useSetCrosshairPoint();

  const moveCrosshair = (point: ReturnType<typeof localPoint>) => {
    if (!point) {
      setCrosshairPoint(null);
      return;
    }

    const { x, y } = point;

    if (
      !inRange(x, adjustedLeftMargin, adjustedLeftMargin + innerWidth) ||
      !inRange(y, margin.top, margin.top + innerHeight)
    ) {
      setCrosshairPoint(null);
      return;
    }

    setCrosshairPoint(point);
  };

  const findLinePoint = (point: { x: number; y: number }) => {
    const { x: mouseX, y: mouseY } = point;

    const datePoint = !isMetrics ? startOfDay(xScale.invert(mouseX)) : new Date(xScale.invert(mouseX));

    const completeData: any[] = series;

    const dataPoints = completeData.reduce((accPoint: any[], { fill, legend, points, stroke }) => {
      if (!points.length) return accPoint;

      const lastDatePoint = !isMetrics
        ? convertToUTC(points[points.length - 1].date).toDate()
        : new Date(points[points.length - 1].date);

      if (
        !isMetrics &&
        (datePoint > convertToUTC(lastDatePoint).toDate() || datePoint < convertToUTC(points[0].date).toDate())
      ) {
        return accPoint;
      }

      const point = points.find((p: Point) => isSameDay(convertToUTC(p.date).toDate(), datePoint));

      if (point) {
        accPoint = [
          ...accPoint,
          {
            label: legend,
            value: point.value,
            date: point.date,
            stroke: stroke ?? fill,
          },
        ];
      }

      return accPoint;
    }, []);

    if (dataPoints && dataPoints.length > 0) {
      showTooltip({
        tooltipData: [
          {
            label: !isMetrics ? "Date" : "Time",
            value: !isMetrics ? format(datePoint, "MMM dd, yy") : format(datePoint, "HH:mm:ss"),
            stroke: "transparent",
          },
          ...dataPoints,
        ],
        tooltipLeft: mouseX,
        tooltipTop: mouseY,
      });
    } else {
      if (tooltipOpen) hideTooltip();
    }
  };

  const zoomGlobal = useRef<ZoomBehavior<Element, unknown>>();

  useEffect(() => {
    if (Math.round(currentZoomStateX.k) !== 1 || Math.round(currentZoomStateY.k) !== 1) {
      setIsChartZoomed(true);
    } else {
      setIsChartZoomed(false);
    }
  }, [currentZoomStateY, currentZoomStateX]);

  useEffect(() => {
    const svg = select(svgRef.current);
    zoomGlobal.current = zoom()
      .scaleExtent([1, 100])
      .translateExtent([
        [0, 0],
        [svgWidth, svgHeight],
      ])
      .on("zoom", (event) => {
        const isCtrl = event.sourceEvent && (event.sourceEvent.ctrlKey || event.sourceEvent.metaKey);
        const { k: newK, x: newX, y: newY } = event.transform;
        const { k: prevK, x: prevX, y: prevY } = currentGlobalZoomState;
        const scale = newK / prevK;
        if (zoomAxis === "x" && !isCtrl) {
          setCurrentZoomStateX(currentZoomStateX.translate((newX - prevX) / prevK, prevY).scale(scale));
        } else {
          setCurrentZoomStateY(currentZoomStateY.translate(prevX, (newY - prevY) / prevK).scale(scale));
        }
        setCurrentGlobalZoomState(event.transform);
      });

    //@ts-ignore
    svg.call(zoomGlobal.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustedLeftMargin, dateRange, innerWidth, svgWidth, svgHeight, currentGlobalZoomState]);

  useEffect(() => {
    if (!resetZoom) {
      if (currentZoomStateX.k !== 1 || currentZoomStateY.k !== 1) {
        setResetZoom?.(true);
      }
    }
  }, [currentZoomStateX, currentZoomStateY, xScale, yScale, zoomAxis, resetZoom, setResetZoom]);

  useEffect(() => {
    const svg = select(svgRef.current);

    if (!resetZoom) {
      //@ts-ignore
      svg.call(zoomGlobal.current?.transform, zoomIdentity);
      setCurrentZoomStateX(zoomIdentity);
      setCurrentZoomStateY(zoomIdentity);
      setCurrentGlobalZoomState(zoomIdentity);
    }
  }, [resetZoom]);

  const onMouseMove = (event: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    const point = localPoint(event);
    findLinePoint(point ?? { x: 0, y: 0 });
    moveCrosshair(point);
  };

  const onMouseOut = () => {
    if (tooltipOpen) hideTooltip();
  };

  const gridStroke = colorMode === "light" ? colors.grey100 : colors.grey700;

  const showDatesAxis = xScale
    .ticks()
    .map(getDate)
    .some((date) => date !== 1);

  const { largeTickFormat, mediumTickFormat, smallTickFormat } = useMemo(() => {
    return handleTickFormats(dateRange[0], dateRange[1]);
  }, [dateRange]);

  return (
    <Wrapper>
      <GraphWrapper>
        <Svg height={svgHeight} width={svgWidth} onMouseMove={onMouseMove} onMouseOut={onMouseOut} ref={svgRef}>
          <GridRows
            left={adjustedLeftMargin}
            pointerEvents="none"
            scale={yScale}
            stroke={gridStroke}
            width={innerWidth}
          />
          <GridColumns
            height={innerHeight}
            pointerEvents="none"
            scale={xScale}
            stroke={gridStroke}
            strokeDasharray="2"
            top={margin.top}
          />
          <AxisLeft
            left={adjustedLeftMargin}
            numTicks={8}
            scale={yScale}
            stroke={gridStroke}
            tickLength={0}
            tickLabelProps={() => ({
              fill: colorMode === "light" ? colors.grey500 : colors.grey400,
              fontSize: 10,
              textAnchor: "end",
              transform: "translate(-12 0)",
              verticalAnchor: "middle",
            })}
            tickStroke={gridStroke}
          />
          {(showDatesAxis || isMetrics) && (
            <AxisBottom
              scale={xScale}
              stroke={gridStroke}
              // @ts-ignore
              tickFormat={(value: any) =>
                format(zonedTimeToUtc(value, Intl.DateTimeFormat().resolvedOptions().timeZone), smallTickFormat)
              }
              tickLabelProps={() => ({
                fill: colorMode === "light" ? "#6D7681" : "#8B949E",
                fontSize: 10,
                textAnchor: "middle",
                transform: "translate(0, 2)",
              })}
              tickLength={0}
              top={innerHeight + margin.top}
            />
          )}
          <AxisBottom
            hideAxisLine={!showDatesAxis}
            scale={xScale}
            stroke={gridStroke}
            // @ts-ignore
            tickFormat={(value: any) =>
              format(zonedTimeToUtc(value, Intl.DateTimeFormat().resolvedOptions().timeZone), mediumTickFormat)
            }
            tickLabelProps={() => ({
              fill: colorMode === "light" ? "#6D7681" : "#8B949E",
              fontSize: 10,
              textAnchor: "middle",
            })}
            tickLength={0}
            tickValues={uniqBy(xScale.ticks(), (date) => format(convertToUTC(date).toDate(), mediumTickFormat))}
            top={innerHeight + margin.top + (showDatesAxis ? 16 : 10)}
          />
          <AxisBottom
            scale={xScale}
            stroke={gridStroke}
            tickFormat={(value: any) => format(convertToUTC(value).toDate(), largeTickFormat)}
            tickLabelProps={() => ({
              fill: colorMode === "light" ? "#30363D" : "#8B949E",
              fontSize: 10,
              textAnchor: "middle",
            })}
            tickLength={8}
            tickStroke={gridStroke}
            tickValues={uniqBy(xScale.ticks(), (date) => getYear(new Date(date)))}
            top={innerHeight + margin.top + 32}
          />
          <defs>
            <clipPath id={`scenarioGraphsClip-${chartId}`}>
              <rect height={innerHeight} width={innerWidth} x={adjustedLeftMargin} y={margin.top} />
            </clipPath>
          </defs>
          <g clipPath={`url(#scenarioGraphsClip-${chartId})`}>
            {areaSeries.map((graph) => (
              <AreaGraph
                graph={graph}
                hideTooltip={hideTooltip}
                key={graph.id}
                showTooltip={showTooltip}
                xScale={xScale}
                yScale={yScale}
              />
            ))}
            {lineSeries.map((graph) => (
              <LineGraph graph={graph} key={graph.id} xScale={xScale} yScale={yScale} />
            ))}
          </g>
          <Crosshair
            xFrom={adjustedLeftMargin}
            xTo={adjustedLeftMargin + innerWidth}
            yFrom={margin.top}
            yTo={margin.top + innerHeight}
          />
        </Svg>

        {showHorizontalSlider && <HorizontalSlider value={xZoom} onChange={handleXZoom} />}
        {showVerticalSlider && <VerticalSlider value={yZoom} onChange={handleYZoom} />}

        {tooltipData && (
          <Tooltip left={tooltipLeft} top={tooltipTop}>
            {tooltipData.map(({ label, value, stroke }) => (
              <TooltipText key={label}>
                <ColorLabel style={{ background: stroke }} /> <TooltipLabel>{label}:</TooltipLabel>
                {typeof value === "number" ? new Intl.NumberFormat().format(value) : value}
              </TooltipText>
            ))}
          </Tooltip>
        )}
      </GraphWrapper>
    </Wrapper>
  );
};

const EnhanceWithCrosshair = (props: Props) => (
  <CrosshairProvider>
    <ChartBase {...props} />
  </CrosshairProvider>
);

export default withParentSize<Props & WithParentSizeProps>(EnhanceWithCrosshair);
