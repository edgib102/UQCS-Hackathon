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
    ctx.strokeStyle = '#FF4136'; // A bright, visible color
    ctx.stroke();
    ctx.restore();
  }
};


// MODIFIED: Updated function signature and logic
export function renderHipHeightChart(canvas, hipData, symmetryData, stabilityData) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // ADDED: Register the custom plugin
  Chart.register(playbackCursorPlugin);

  const chartConfig = {
    type: 'line',
    data: {
      // MODIFIED: Use the length of the data for labels, not frame index
      labels: Array.from({ length: hipData.length }, (_, i) => i),
      datasets: [
        {
          label: 'Hip Height (Depth)',
          data: hipData,
          borderColor: '#00CFFF',
          backgroundColor: 'rgba(0, 207, 255, 0.1)',
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
        // ADDED: Dataset for Knee Stability
        {
          label: 'Knee Stability',
          data: stabilityData,
          borderColor: '#FF4136', // A new distinct color
          backgroundColor: 'rgba(54, 162, 235, 0.1)',
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
        // ADDED: Configuration for our custom plugin
        playbackCursor: {
          frame: null
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
            // MODIFIED: More generic title for the axis
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