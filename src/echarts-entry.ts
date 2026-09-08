import * as echarts from "echarts/core";
import { LineChart, BarChart, HeatmapChart } from "echarts/charts";
import { AriaComponent, DatasetComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, HeatmapChart, AriaComponent, DatasetComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);
(globalThis as unknown as { echarts: typeof echarts }).echarts = echarts;