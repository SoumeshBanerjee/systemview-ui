import { SysViewEvent, LookUpTable } from "./model";

export function generateLookupTable(events: SysViewEvent[]): LookUpTable {
  const lookupTable: LookUpTable = {};

  events.forEach((evt: SysViewEvent) => {
    if (!lookupTable[evt.core_id]) {
      lookupTable[evt.core_id] = {
        irq: {},
        ctx: {},
        lastEvent: null,
        contextSwitch: {
          name: "context-switch",
          line: {
            color: "blue",
            width: 0.5,
          },
          mode: "lines",
          opacity: 0.5,
          type: "scatterql",
          x: [],
          y: [],
          xaxis: "x",
          yaxis: evt.core_id === 1 ? "y2" : "y",
          // visible: "legendonly",
          hoverinfo: "skip",
        },
      };
    }

    if (
      evt.in_irq === true &&
      !lookupTable[evt.core_id].irq.hasOwnProperty(evt.ctx_name)
    ) {
      lookupTable[evt.core_id].irq[evt.ctx_name] = {};
    } else if (
      evt.in_irq === false &&
      !lookupTable[evt.core_id].ctx.hasOwnProperty(evt.ctx_name)
    ) {
      lookupTable[evt.core_id].ctx[evt.ctx_name] = {};
    }
  });

  return lookupTable;
}

export function calculateAndInjectDataPoints(
  events: SysViewEvent[],
  lookupTable: LookUpTable,
  ignoreRenderIds: Set<number>,
  sysOverflowId: number
): { xmin: number; xmax: number } {
  function drawContextSwitch(
    coreId: number,
    previousYAxis: any,
    currentYAxis: any,
    commonXAxis: any
  ) {
    if (previousYAxis === currentYAxis) {
      return;
    }
    const contextSwitch = lookupTable[coreId].contextSwitch;
    contextSwitch.x.push(commonXAxis, commonXAxis, null);
    contextSwitch.y.push(previousYAxis, currentYAxis, null);
  }
  function stopLastEventBar(coreId: number, stopTimeStamp: number) {
    const previousEvt = lookupTable[coreId].lastEvent;
    if (!previousEvt) {
      return;
    }
    const previousData =
      previousEvt.in_irq === true
        ? lookupTable[coreId].irq[previousEvt.ctx_name]
        : lookupTable[coreId].ctx[previousEvt.ctx_name];

    //stop for last event
    previousData.x.push(stopTimeStamp, null);
    previousData.y.push(previousData.name, null);
  }

  const range = {
    xmin: Number.POSITIVE_INFINITY,
    xmax: Number.NEGATIVE_INFINITY,
  };

  events.forEach((evt: SysViewEvent) => {
    //Ignore the list of ignored System Events
    if (ignoreRenderIds.has(evt.id)) {
      return;
    }
    //SYS_OVERFLOW event halt all the running tasks and draw void rect
    if (evt.id === sysOverflowId) {
      console.log("Halt event arrived", evt);
      //halts both the tasks running on both the core
      stopLastEventBar(0, evt.ts);
      stopLastEventBar(1, evt.ts);

      //set previous event as null for both core
      lookupTable[0].lastEvent = null;
      lookupTable[1].lastEvent = null;

      //ignore everything else and continue like a fresh start
      return;
    }
    if (evt.ts >= range.xmax) {
      range.xmax = evt.ts;
    }
    if (evt.ts <= range.xmin) {
      range.xmin = evt.ts;
    }

    let data = lookupTable[evt.core_id].ctx[evt.ctx_name];
    if (evt.in_irq === true) {
      data = lookupTable[evt.core_id].irq[evt.ctx_name];
    }

    if (!data.type) {
      data.type = "scattergl";
      data.mode = "lines";
      data.opacity = 0.9;
      data.line = { width: 20 };
      data.name = evt.in_irq === true ? `IRQ: ${evt.ctx_name}` : evt.ctx_name;
      if (evt.core_id === 1) {
        data.yaxis = "y2";
        data.xaxis = "x";
      }
      data.y = [];
      data.x = [];
    }
    //stop the last event bar (if exists)
    stopLastEventBar(evt.core_id, evt.ts);

    //draw context switch
    const previousEvt = lookupTable[evt.core_id].lastEvent;
    if (previousEvt) {
      const previousData =
        previousEvt.in_irq === true
          ? lookupTable[evt.core_id].irq[previousEvt.ctx_name]
          : lookupTable[evt.core_id].ctx[previousEvt.ctx_name];
      drawContextSwitch(evt.core_id, previousData.name, data.name, evt.ts);
    }

    //start point for current evt
    data.x.push(evt.ts);
    data.y.push(data.name);

    //store current event for a core as last event for the same core
    lookupTable[evt.core_id].lastEvent = evt;
  });
  return range;
}

function addColorToEvent(trace: SysViewEvent, color: string) {
  if (trace && trace.mode === "lines") {
    trace.line.color = color;
  }
}

function findAndColorizeTasksInAllCores(
  taskName: string,
  color: string,
  lookupTable: LookUpTable,
  coreId: any
) {
  let colored = false;
  Object.keys(lookupTable).forEach((core_id) => {
    if (core_id === coreId) {
      return;
    }
    const task = lookupTable[core_id].ctx[taskName];
    if (task && task.mode === "lines") {
      task.line.color = color;
      colored = true;
    }
  });
  return colored;
}

export function populatePlotData(lookupTable: LookUpTable): Array<any> {
  /**
   * Plot Population Strategy
   * IRQ1
   * ...
   * IRQN
   * -----------------------------
   * Scheduler
   * -----------------------------
   * Tasks1
   * ...
   * TasksN
   * -----------------------------
   * IDLE
   */
  const plotData = [];
  Object.keys(lookupTable).forEach((coreId) => {
    const cpuCore = lookupTable[coreId];

    const taskPriorityList = new Set<string>();
    const contextNames = new Set<string>(Object.keys(cpuCore.ctx));

    contextNames.forEach((name) => {
      if (name.match(/^IDLE[0-9]*/)) {
        const eventTrace = cpuCore.ctx[name];
        addColorToEvent(eventTrace, "#c2ffcc");
        taskPriorityList.add(name);
        contextNames.delete(name);
      }
    });

    contextNames.forEach((name) => {
      if (name !== "scheduler") {
        const color = `#${((Math.random() * 16777216) | 0).toString(16)}`;
        if (
          findAndColorizeTasksInAllCores(name, color, lookupTable, coreId) &&
          cpuCore.ctx[name].mode === "lines"
        ) {
          cpuCore.ctx[name].line.color = color;
        }
        taskPriorityList.add(name);
        contextNames.delete(name);
      }
    });

    if (contextNames.has("scheduler")) {
      const eventTrace = cpuCore.ctx["scheduler"];
      addColorToEvent(eventTrace, "#444444");
      taskPriorityList.add("scheduler");
      contextNames.delete("scheduler");
    }

    taskPriorityList.forEach((name) => {
      plotData.push(cpuCore.ctx[name]);
    });

    Object.keys(cpuCore.irq).forEach((irq) => {
      plotData.push(cpuCore.irq[irq]);
    });
    plotData.push(cpuCore.contextSwitch);
  });
  return plotData;
}
