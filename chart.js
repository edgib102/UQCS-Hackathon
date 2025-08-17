// chart.js

/**
 * Renders a line chart of hip height, symmetry, and stability over time.
 * @param {HTMLCanvasElement} canvas The canvas element to draw the chart on.
 * @param {number[]} hipData An array of hip Y-coordinates.
 * @param {number[]} symmetryData An array of symmetry percentages.
 * @param {number[]} stabilityData An array of knee stability percentages.
 * @returns {Chart} The Chart.js instance.
 */

// ADDED: A Chart.js plugin to draw a vertical line for playback scrubbing
const playbackCursorPlugin = {
  id: 'playbackCursor',
  afterDraw: (chart) => {
    const frame = chart.options.plugins.playbackCursor.frame;
    if (frame === null || frame === undefined) {
      return;
    }

    const ctx = chart.ctx;
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;
    const xPos = xAxis.getPixelForValue(frame);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xPos, yAxis.top);
    ctx.lineTo(xPos, yAxis.bottom);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#14b8a6'; // MODIFIED: Changed from red to teal-500
    ctx.stroke();
    ctx.restore();
  }
};

// MODIFIED: A Chart.js plugin to draw a shaded background region for a selected rep
const repHighlighterPlugin = {
  id: 'repHighlighter',
  beforeDatasetsDraw: (chart) => {
    const { startFrame, endFrame, color } = chart.options.plugins.repHighlighter;
    // It will not draw if no color is provided
    if (startFrame === null || endFrame === null || !color) {
      return;
    }

    const ctx = chart.ctx;
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;

    const startX = xAxis.getPixelForValue(startFrame);
    const endX = xAxis.getPixelForValue(endFrame);

    ctx.save();
    // Use the dynamic color from the plugin options
    ctx.fillStyle = color; 
    ctx.fillRect(startX, yAxis.top, endX - startX, yAxis.height);
    ctx.restore();
  }
};


// MODIFIED: Updated function signature and logic
export function renderHipHeightChart(canvas, hipData, symmetryData, stabilityData) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // MODIFIED: Register both custom plugins
  Chart.register(playbackCursorPlugin, repHighlighterPlugin);

  const chartConfig = {
    type: 'line',
    data: {
      labels: Array.from({ length: hipData.length }, (_, i) => i),
      datasets: [
        {
          label: 'Hip Height (Depth)',
          data: hipData,
          borderColor: '#00CFFF',
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          yAxisID: 'y', // Assign to the left y-axis
        },
        {
          label: 'Symmetry',
          data: symmetryData,
          borderColor: '#FF9E00', // Secondary color
          backgroundColor: 'rgba(255, 158, 0, 0.1)',
          fill: false, // Keep it a clean line
          tension: 0.4,
          pointRadius: 0,
          yAxisID: 'y1', // Assign to the right y-axis
        },
        {
          label: 'Knee Stability',
          data: stabilityData,
          borderColor: '#FF4136', // A new distinct color
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          yAxisID: 'y1', // Shares the right y-axis with Symmetry
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        playbackCursor: {
          frame: null
        },
        // MODIFIED: Default configuration now includes a 'color' property
        repHighlighter: {
            startFrame: null,
            endFrame: null,
            color: null
        },
        legend: {
          display: true, // Display labels for the lines
          labels: {
            color: '#e0e0e0',
            font: { family: "'Roboto Mono', monospace" }
          }
        },
        title: {
            display: true,
            text: 'Form Analysis Over Time',
            color: '#e0e0e0',
            font: {
                family: "'Roboto Mono', monospace",
                size: 16
            }
        }
      },
      scales: {
        y: { // Left Y-Axis (Hip Height)
          type: 'linear',
          position: 'left',
          reverse: true,
          title: {
            display: true,
            text: 'Vertical Position (Lower is Deeper)',
            color: '#00CFFF',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: { color: '#333333' },
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        },
        y1: { // Right Y-Axis (Symmetry & Stability)
          type: 'linear',
          position: 'right',
          min: 0,
          max: 100,
          title: {
            display: true,
            text: 'Performance (%)',
            color: '#FF9E00',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: { drawOnChartArea: false }, // Don't draw grid lines from this axis
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        },
        x: {
          title: {
            display: true,
            text: 'Time (Frames)',
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          },
          grid: { color: '#333333' },
          ticks: {
            color: '#888888',
            font: { family: "'Roboto Mono', monospace" }
          }
        }
      }
    }
  };

  return new Chart(ctx, chartConfig);
}