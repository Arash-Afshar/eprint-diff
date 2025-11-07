// Content script for EPRINT Archive PDF Diff extension

(function() {
  'use strict';

  // Load pdf.js library using dynamic import for ES module
  async function loadPDFJS() {
    // Check if already loaded
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
      return window.pdfjsLib;
    }

    try {
      // Load PDF.js as ES module using dynamic import
      // PDF.js v5 exports all functions/classes as named exports
      const pdfjsModule = await import(chrome.runtime.getURL('pdf.min.mjs'));
      
      // PDF.js v5 doesn't have a default export, it exports everything as named exports
      // We need to use the module itself or access getDocument directly
      const pdfjsLib = pdfjsModule;
      
      // Set worker source
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
      
      // Store globally for reuse
      window.pdfjsLib = pdfjsLib;
      
      return pdfjsLib;
    } catch (error) {
      console.error('EPRINT Diff: Error loading PDF.js:', error);
      throw new Error('pdf.js library failed to load: ' + error.message);
    }
  }

  // Load pdf-lib library - it should already be loaded via manifest
  async function loadPDFLib() {
    if (window.PDFLib) {
      return window.PDFLib;
    }

    // If not loaded, wait a bit (shouldn't happen if loaded via manifest)
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const checkInterval = setInterval(() => {
        if (window.PDFLib) {
          clearInterval(checkInterval);
          resolve(window.PDFLib);
        } else if (attempts++ > 20) {
          clearInterval(checkInterval);
          reject(new Error('pdf-lib library failed to load'));
        }
      }, 100);
    });
  }

  // Create the UI container
  function createDiffUI() {
    const container = document.createElement('div');
    container.id = 'eprint-diff-container';
    container.className = 'eprint-diff-container';
    container.innerHTML = `
      <button class="eprint-diff-close" onclick="this.parentElement.remove()">×</button>
      <div class="eprint-diff-title">Compare PDF Versions</div>
      <div class="eprint-diff-section">
        <label class="eprint-diff-label" for="eprint-select-1">Select First Version:</label>
        <select id="eprint-select-1" class="eprint-diff-select">
          <option value="">-- Select --</option>
        </select>
      </div>
      <div class="eprint-diff-section">
        <label class="eprint-diff-label" for="eprint-select-2">Select Second Version:</label>
        <select id="eprint-select-2" class="eprint-diff-select">
          <option value="">-- Select --</option>
        </select>
      </div>
      <button id="eprint-diff-button" class="eprint-diff-button" disabled>Compare PDFs</button>
      <div id="eprint-diff-status"></div>
    `;
    document.body.appendChild(container);
    return container;
  }

  // Extract archive links from the page
  function extractArchiveLinks() {
    const links = [];
    // Pattern to match: /archive/YEAR/NUMBER/TIMESTAMP or /archive/versions/YEAR/NUMBER/REVISION
    // Timestamp format: YYYYMMDD:HHMMSS
    const urlPattern = /\/archive\/(?:versions\/)?(\d+)\/(\d+)\/([\d:]+)/;
    
    // Find all links on the page
    const allLinks = document.querySelectorAll('a[href]');
    console.log('EPRINT Diff: Scanning', allLinks.length, 'links on page');
    
    allLinks.forEach(link => {
      const href = link.href || link.getAttribute('href');
      if (!href) return;
      
      // Handle relative URLs
      let fullUrl = href;
      if (href.startsWith('/')) {
        fullUrl = window.location.origin + href;
      } else if (!href.startsWith('http')) {
        fullUrl = new URL(href, window.location.href).href;
      }
      
      // Try to match the pattern
      const match = fullUrl.match(urlPattern);
      if (match) {
        const [, year, number, revision] = match;
        
        // Construct the archive URL (without .pdf)
        // The actual format appears to be: https://eprint.iacr.org/archive/YEAR/NUMBER/TIMESTAMP
        const archiveUrl = `https://eprint.iacr.org/archive/${year}/${number}/${revision}`;
        
        console.log('EPRINT Diff: Found archive link:', {
          originalHref: href,
          fullUrl: fullUrl,
          archiveUrl: archiveUrl
        });
        
        // Avoid duplicates
        if (!links.find(l => l.url === archiveUrl)) {
          // Extract display text from the link or use revision
          const linkText = link.textContent.trim();
          const displayText = linkText || `${year}/${number}/${revision}`;
          
          links.push({
            url: archiveUrl,
            year: parseInt(year),
            number: parseInt(number),
            revision: revision, // Keep as string since it might be a timestamp
            displayText: displayText
          });
        }
      }
    });

    // Sort by revision (treating timestamps as strings, newer timestamps come first)
    links.sort((a, b) => {
      // If both are timestamps (contain ':'), compare as strings (newer = larger)
      if (a.revision.includes(':') && b.revision.includes(':')) {
        return b.revision.localeCompare(a.revision);
      }
      // Otherwise compare as numbers
      return parseInt(b.revision) - parseInt(a.revision);
    });
    
    console.log('EPRINT Diff: Extracted links:', links.map(l => l.displayText));
    return links;
  }

  // Populate select dropdowns
  function populateSelects(links) {
    const select1 = document.getElementById('eprint-select-1');
    const select2 = document.getElementById('eprint-select-2');
    
    links.forEach(link => {
      const option1 = document.createElement('option');
      option1.value = link.url;
      option1.textContent = link.displayText;
      select1.appendChild(option1);
      
      const option2 = document.createElement('option');
      option2.value = link.url;
      option2.textContent = link.displayText;
      select2.appendChild(option2);
    });
  }

  // Enable/disable compare button based on selections
  function updateCompareButton() {
    const select1 = document.getElementById('eprint-select-1');
    const select2 = document.getElementById('eprint-select-2');
    const button = document.getElementById('eprint-diff-button');
    
    if (select1.value && select2.value && select1.value !== select2.value) {
      button.disabled = false;
    } else {
      button.disabled = true;
    }
  }

  // Fetch the archive page and extract PDF URL
  async function getPDFUrl(archiveUrl) {
    try {
      const response = await fetch(archiveUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch archive page: ${response.statusText}`);
      }
      const html = await response.text();
      
      // Parse HTML to find PDF link/button
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Look for links/buttons containing "PDF" text
      const allLinks = doc.querySelectorAll('a, button');
      let pdfUrl = null;
      
      for (const element of allLinks) {
        const text = element.textContent.trim().toUpperCase();
        const href = element.href || element.getAttribute('href');
        
        // Check if it's a PDF link (contains "PDF" in text or href ends with .pdf)
        if ((text.includes('PDF') || (href && href.endsWith('.pdf'))) && href) {
          // Resolve relative URLs
          if (href.startsWith('/')) {
            pdfUrl = window.location.origin + href;
          } else if (href.startsWith('http')) {
            pdfUrl = href;
          } else {
            pdfUrl = new URL(href, archiveUrl).href;
          }
          
          // Make sure it's actually a PDF URL
          if (pdfUrl.endsWith('.pdf') || pdfUrl.includes('.pdf')) {
            console.log('EPRINT Diff: Found PDF URL:', pdfUrl, 'from archive:', archiveUrl);
            return pdfUrl;
          }
        }
      }
      
      // Alternative: look for any link ending in .pdf
      const pdfLinks = doc.querySelectorAll('a[href$=".pdf"]');
      if (pdfLinks.length > 0) {
        let href = pdfLinks[0].href || pdfLinks[0].getAttribute('href');
        if (href.startsWith('/')) {
          pdfUrl = window.location.origin + href;
        } else if (!href.startsWith('http')) {
          pdfUrl = new URL(href, archiveUrl).href;
        } else {
          pdfUrl = href;
        }
        console.log('EPRINT Diff: Found PDF URL via .pdf selector:', pdfUrl);
        return pdfUrl;
      }
      
      throw new Error('Could not find PDF link on archive page');
    } catch (error) {
      console.error('EPRINT Diff: Error getting PDF URL:', error);
      throw error;
    }
  }

  // Fetch PDF as ArrayBuffer
  async function fetchPDF(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }


  // Find text differences between two pages
  function findTextDifferences(items1, items2, viewport1, viewport2, pageHeight1 = null, pageHeight2 = null) {
    const result = {
      hasChanges: false,
      deleted: [], // Regions only in page 1
      added: [],   // Regions only in page 2
      modified: [] // Regions that changed
    };
    
    // Extract text items with proper bounding boxes
    const extractTextItems = (items, viewport, pageHeight = null) => {
      // Use pdf-lib page height if provided, otherwise use viewport height
      const heightForConversion = pageHeight || viewport.height;
      return items.map(item => {
        // Extract position from transform matrix [a, b, c, d, x, y]
        // item.transform[4] = x (left edge)
        // item.transform[5] = y (baseline in pdf.js top-down coordinates)
        const x = item.transform[4];
        
        // Calculate width and height first
        const width = item.width || Math.abs(item.transform[0]) * (item.str.length || 1) * 6 || 20;
        const height = item.height || Math.abs(item.transform[3]) || 12;
        
        // Convert coordinates from pdf.js (top-down) to pdf-lib (bottom-up)
        // In pdf.js: Y=0 at top, Y increases downward
        // In pdf-lib: Y=0 at bottom, Y increases upward
        // item.transform[5] is the baseline Y in top-down coordinates
        // The baseline is typically where characters sit
        // In PDF coordinate systems, the baseline is usually at the BOTTOM of the text box
        // (text extends upward from the baseline for ascenders)
        // However, if highlights are appearing at the bottom instead of top, the baseline
        // might be at the TOP of the text box, or we need to account for height differently
        const baselineYTopDown = item.transform[5];
        
        // The baseline in pdf.js represents where text sits
        // If highlights are appearing at the bottom instead of top, we need to adjust
        // In PDF coordinate systems, typically:
        // - Baseline is at the BOTTOM of the text (text extends upward)
        // - But pdf.js might report it differently
        // 
        // If highlights appear at bottom when text is at top, the Y is too small
        // Try: use the TOP of the text box as reference, then convert
        // Top of text box (top-down) = baselineY (if baseline is at top) OR baselineY - height (if at bottom)
        // Bottom of text box (top-down) = baselineY + height (if baseline at top) OR baselineY (if at bottom)
        //
        // Since highlights are too low, try: baseline represents TOP, so bottom = baseline + height
        // But wait - if baseline is at top and we add height, we get a larger Y (further down in top-down)
        // Which converts to a smaller Y in bottom-up (closer to bottom) - that's wrong!
        //
        // Let's try the opposite: if baseline is at bottom, top = baseline - height
        // Top of text (top-down) = baselineY - height
        // Top of text (bottom-up) = viewport.height - (baselineY - height) = viewport.height - baselineY + height
        // But we need bottom-left corner, so: bottom = top - height = (viewport.height - baselineY + height) - height = viewport.height - baselineY
        // That's what we had before!
        //
        // Maybe the issue is that we need to use the TOP as the Y coordinate for drawRectangle?
        // Or maybe height needs to be negative?
        //
        // Let's try: use baselineY directly as if it's the top, and calculate bottom from there
        // If baseline is at top: bottomY (top-down) = baselineY + height
        // bottomY (bottom-up) = viewport.height - (baselineY + height)
        // But this makes it lower, not higher...
        //
        // Standard conversion: baseline is at bottom of text box
        // Bottom of text box (top-down) = baselineY
        // Bottom of text box (bottom-up) = viewport.height - baselineY
        // But if this puts highlights at bottom, try inverting:
        // Maybe pdf-lib's drawRectangle Y is measured from TOP, not bottom?
        // Or maybe we need to account for the text extending above the baseline?
        // 
        // Try: calculate top of text box instead
        // Top of text (top-down) = baselineY - height (text extends upward from baseline)
        // Top of text (bottom-up) = viewport.height - (baselineY - height) = viewport.height - baselineY + height
        // But drawRectangle needs bottom-left, so subtract height:
        // bottomY = (viewport.height - baselineY + height) - height = viewport.height - baselineY
        // That's the same as before!
        //
        // Let me try the opposite: maybe the coordinate system is completely inverted
        // Try: bottomY = baselineY (treating pdf.js Y as if it's already bottom-up)
        // This would only work if both use the same system, which they don't...
        //
        // Actually, let me check: maybe we need to use the TOP of the text box as Y,
        // and then drawRectangle will extend downward? But pdf-lib docs say Y is bottom-left...
        //
        // Let's try: use top of text box as Y coordinate
        const textTopYTopDown = baselineYTopDown - height;
        const textTopYBottomUp = viewport.height - textTopYTopDown;
        // But drawRectangle expects bottom-left, so we'd need: bottomY = topY - height
        // bottomY = (viewport.height - baselineY + height) - height = viewport.height - baselineY
        // Again same result!
        //
        // Maybe the issue is that height needs to be subtracted in the drawRectangle call?
        // Or maybe the viewport heights are different between the two PDFs?
        //
        // Use the provided page height (from pdf-lib) for conversion if available
        // This ensures we're using the same coordinate system as pdf-lib
        // Standard conversion: bottomY = height - baselineY (converting top-down to bottom-up)
        // But if highlights appear at bottom instead of top, try inverting:
        // Maybe pdf-lib uses top-down coordinates too? Or the conversion is wrong?
        // Try: bottomY = baselineY (no conversion - treating as if same coordinate system)
        // This would put text at top (small baselineY) at top (small bottomY in bottom-up = bottom of page)
        // That's wrong too...
        //
        // Actually, if highlights are at bottom when text is at top, it means bottomY is too small
        // In bottom-up: small Y = bottom of page, large Y = top of page
        // So if text is at top (baselineY small), we need large bottomY
        // Standard: bottomY = height - baselineY gives large bottomY when baselineY is small ?
        // But user says it appears at bottom, meaning bottomY is small ?
        //
        // Maybe the issue is that we need to ADD height instead of subtract?
        // Or maybe pdf-lib's Y coordinate works differently?
        //
        // If highlights appear at bottom when text is at top, pdf-lib might use top-down coordinates
        // Try: use baselineY directly (no conversion)
        // In top-down: text at top has small Y (e.g., 50)
        // If pdf-lib also uses top-down: Y=50 puts rectangle at top ?
        // But pdf-lib docs say it uses bottom-up... unless drawRectangle is different?
        // 
        // Actually, let me check: maybe we need to use the TOP of the text box, not bottom?
        // Top of text (top-down) = baselineY - height (if baseline is at bottom)
        // Top of text (bottom-up) = height - (baselineY - height) = height - baselineY + height = 2*height - baselineY
        // That seems wrong...
        //
        // If standard conversion puts highlights at bottom, try adding height to move up
        // Standard: bottomY = height - baselineY
        // If this is too low, try: bottomY = height - baselineY + height = 2*height - baselineY
        // This moves the Y coordinate up by 'height' pixels
        // But wait, that would make it too high...
        //
        // Actually, let me reconsider: if text is at top (baselineY small, e.g., 50)
        // Standard conversion: bottomY = height - 50 = 750 (should be at top in bottom-up)
        // But user says it appears at bottom, meaning bottomY is actually small (e.g., 50)
        // This suggests the conversion is inverted: maybe we should use baselineY directly?
        // Or maybe: bottomY = baselineY + height?
        //
        // Let's try: bottomY = height - baselineY + height = 2*height - baselineY
        // For text at top (baselineY=50, height=800): bottomY = 1600 - 50 = 1550 (way too high!)
        //
        // Debug: log coordinate conversion for date-related text
        const isDateText = /(September|January|2014|2015|30|29)/i.test(item.str);
        if (isDateText) {
          console.log(`EPRINT Diff: extractTextItems - "${item.str}": baselineYTopDown=${baselineYTopDown.toFixed(2)}, heightForConversion=${heightForConversion.toFixed(2)}, height=${height.toFixed(2)}`);
        }
        
        // Try inverted conversion: if standard puts highlights at bottom, try: bottomY = baselineY
        // This assumes pdf-lib uses top-down coordinates (contrary to docs, but might be the case)
        // OR the coordinate system is already converted when pages are copied
        // 
        // Actually, let's try the standard conversion first with pdf-lib page height:
        // bottomY = pageHeight - baselineY (converting top-down to bottom-up)
        // If this still doesn't work, we can try: bottomY = baselineY (no conversion)
        const USE_INVERTED_Y = true; // Set to false to use standard conversion
        const bottomYBottomUp = USE_INVERTED_Y 
          ? baselineYTopDown  // Test: use baselineY directly (assumes top-down or already converted)
          : heightForConversion - baselineYTopDown; // Standard: convert top-down to bottom-up
        
        if (isDateText) {
          console.log(`EPRINT Diff: extractTextItems - "${item.str}": bottomYBottomUp=${bottomYBottomUp.toFixed(2)} (${USE_INVERTED_Y ? 'using baselineY directly' : 'standard conversion'})`);
        }
        
        return {
          text: item.str,
          x: x,
          y: bottomYBottomUp, // Bottom-left Y coordinate (testing: using baselineY directly)
          width: Math.max(width, 20), // Minimum width
          height: Math.max(height, 10), // Minimum height (extends upward from y)
        };
      }).filter(item => item.text.trim()); // Filter out empty/whitespace-only items
    };
    
    const words1 = extractTextItems(items1, viewport1, pageHeight1);
    const words2 = extractTextItems(items2, viewport2, pageHeight2);
    
    // Create text strings for quick comparison (normalized)
    const text1 = words1.map(w => w.text.trim()).filter(t => t).join(' ');
    const text2 = words2.map(w => w.text.trim()).filter(t => t).join(' ');
    
    // If normalized text is identical, no changes
    if (text1 === text2) {
      return result; // No changes
    }
    
    // If word counts are very different, likely real changes
    if (Math.abs(words1.length - words2.length) > words1.length * 0.1) {
      result.hasChanges = true;
    }
    
    // Match words between pages (same text at similar position)
    const matched1 = new Set();
    const matched2 = new Set();
    const tolerance = 15; // pixels - coordinate matching tolerance
    
    // Sort words by position (top to bottom, left to right) for better matching
    const sortWords = (words) => {
      return [...words].sort((a, b) => {
        // First by Y coordinate (top to bottom)
        const yDiff = b.y - a.y; // Higher Y = lower on page
        if (Math.abs(yDiff) > 5) return yDiff;
        // Then by X coordinate (left to right)
        return a.x - b.x;
      });
    };
    
    const sortedWords1 = sortWords(words1);
    const sortedWords2 = sortWords(words2);
    
    // First pass: match identical words at similar positions
    // Use sorted arrays and match in order for better accuracy
    sortedWords1.forEach((word1, i1) => {
      const origIndex1 = words1.indexOf(word1);
      if (matched1.has(origIndex1)) return;
      
      // Find best match in sortedWords2 (search nearby positions first)
      let bestMatch = null;
      let bestDistance = Infinity;
      
      sortedWords2.forEach((word2, i2) => {
        const origIndex2 = words2.indexOf(word2);
        if (matched2.has(origIndex2)) return;
        
        // Check if same text
        if (word1.text.trim() === word2.text.trim()) {
          // Calculate distance
          const distance = Math.sqrt(
            Math.pow(word1.x - word2.x, 2) + 
            Math.pow(word1.y - word2.y, 2)
          );
          
          // Prefer matches that are close in both sorted order and position
          const orderDistance = Math.abs(i1 - i2);
          const combinedDistance = distance + orderDistance * 10;
          
          if (combinedDistance < bestDistance && distance < tolerance * 2) {
            bestDistance = combinedDistance;
            bestMatch = { word2, origIndex2 };
          }
        }
      });
      
      if (bestMatch && bestDistance < tolerance * 2) {
        matched1.add(origIndex1);
        matched2.add(bestMatch.origIndex2);
      }
    });
    
    // Only mark as having changes if significant differences found
    const unmatched1 = words1.filter((w, i) => !matched1.has(i) && w.text.trim());
    const unmatched2 = words2.filter((w, i) => !matched2.has(i) && w.text.trim());
    
    // Calculate match ratios
    const matchRatio1 = matched1.size / Math.max(words1.length, 1);
    const matchRatio2 = matched2.size / Math.max(words2.length, 1);
    
    // Debug logging
    console.log(`EPRINT Diff: findTextDifferences - words1: ${words1.length}, words2: ${words2.length}`);
    console.log(`EPRINT Diff: findTextDifferences - matched1: ${matched1.size}, matched2: ${matched2.size}`);
    console.log(`EPRINT Diff: findTextDifferences - unmatched1: ${unmatched1.length}, unmatched2: ${unmatched2.length}`);
    console.log(`EPRINT Diff: findTextDifferences - matchRatio1: ${matchRatio1.toFixed(3)}, matchRatio2: ${matchRatio2.toFixed(3)}`);
    if (unmatched1.length > 0) {
      console.log(`EPRINT Diff: findTextDifferences - unmatched1 texts:`, unmatched1.slice(0, 10).map(w => w.text));
    }
    if (unmatched2.length > 0) {
      console.log(`EPRINT Diff: findTextDifferences - unmatched2 texts:`, unmatched2.slice(0, 10).map(w => w.text));
    }
    
    // Since we already know text1 !== text2, there must be differences
    // Always report changes if text is different (we already checked text1 !== text2 above)
    // This ensures we catch all differences, even small ones like date changes
    result.hasChanges = true;
    
    // Only add regions if we have unmatched words or low match ratios
    // (This prevents false positives from minor formatting differences)
    if (unmatched1.length > 0 || unmatched2.length > 0 || matchRatio1 < 0.98 || matchRatio2 < 0.98) {
      
      // Find deleted words (in page 1 but not matched)
      unmatched1.forEach((word1) => {
        result.deleted.push({
          x: word1.x,
          y: word1.y,
          width: word1.width,
          height: word1.height,
        });
      });
      
      // Find added words (in page 2 but not matched)
      unmatched2.forEach((word2) => {
        result.added.push({
          x: word2.x,
          y: word2.y,
          width: word2.width,
          height: word2.height,
        });
      });
      
      // Find modified words (same position but different text)
      // First check unmatched words for similar positions
      unmatched1.forEach((word1) => {
        unmatched2.forEach((word2) => {
          const distance = Math.sqrt(
            Math.pow(word1.x - word2.x, 2) + 
            Math.pow(word1.y - word2.y, 2)
          );
          
          // Use a larger tolerance for modified detection (words might be slightly offset)
          if (distance < tolerance * 2 && word1.text.trim() !== word2.text.trim()) {
            result.modified.push({
              x1: word1.x,
              y1: word1.y,
              width1: word1.width,
              height1: word1.height,
              x2: word2.x,
              y2: word2.y,
              width2: word2.width,
              height2: word2.height,
            });
          }
        });
      });
      
      // Also check all words at similar positions (in case matching missed something)
      // This helps catch cases where words are at the same position but weren't matched
      // because they're different text
      words1.forEach((word1, i1) => {
        if (matched1.has(i1)) return; // Skip already matched words
        
        words2.forEach((word2, i2) => {
          if (matched2.has(i2)) return; // Skip already matched words
          
          const distance = Math.sqrt(
            Math.pow(word1.x - word2.x, 2) + 
            Math.pow(word1.y - word2.y, 2)
          );
          
          // If words are at similar positions but have different text, they're modified
          if (distance < tolerance * 2 && word1.text.trim() !== word2.text.trim()) {
            // Check if not already in modified list
            const alreadyAdded = result.modified.some(m => 
              Math.abs(m.x1 - word1.x) < 1 && Math.abs(m.y1 - word1.y) < 1 &&
              Math.abs(m.x2 - word2.x) < 1 && Math.abs(m.y2 - word2.y) < 1
            );
            
            if (!alreadyAdded) {
              result.modified.push({
                x1: word1.x,
                y1: word1.y,
                width1: word1.width,
                height1: word1.height,
                x2: word2.x,
                y2: word2.y,
                width2: word2.width,
                height2: word2.height,
              });
            }
          }
        });
      });
    } else {
      // Even if match ratios are high, if text differs, we should still report something
      // This handles edge cases where text differs but most words match
      console.log(`EPRINT Diff: findTextDifferences - High match ratios but text differs, checking for subtle differences`);
      
      // Look for any words at similar positions with different text
      words1.forEach((word1, i1) => {
        words2.forEach((word2, i2) => {
          const distance = Math.sqrt(
            Math.pow(word1.x - word2.x, 2) + 
            Math.pow(word1.y - word2.y, 2)
          );
          
          // If words are at very similar positions but have different text, they're modified
          if (distance < tolerance && word1.text.trim() !== word2.text.trim()) {
            const alreadyAdded = result.modified.some(m => 
              Math.abs(m.x1 - word1.x) < 1 && Math.abs(m.y1 - word1.y) < 1 &&
              Math.abs(m.x2 - word2.x) < 1 && Math.abs(m.y2 - word2.y) < 1
            );
            
            if (!alreadyAdded) {
              result.modified.push({
                x1: word1.x,
                y1: word1.y,
                width1: word1.width,
                height1: word1.height,
                x2: word2.x,
                y2: word2.y,
                width2: word2.width,
                height2: word2.height,
              });
            }
          }
        });
      });
    }
    
    return result;
  }

  // Compare two PDFs and create a diff PDF
  async function comparePDFs(url1, url2) {
    const statusDiv = document.getElementById('eprint-diff-status');
    statusDiv.className = 'eprint-diff-status loading';
    statusDiv.textContent = 'Loading PDF libraries...';

    try {
      // Load libraries
      const pdfjsLib = await loadPDFJS();
      const PDFLib = await loadPDFLib();
      
      statusDiv.textContent = 'Finding PDF URLs...';
      
      // Get the actual PDF URLs from the archive pages
      const pdfUrl1 = await getPDFUrl(url1);
      const pdfUrl2 = await getPDFUrl(url2);
      
      statusDiv.textContent = 'Fetching PDFs...';
      
      // Fetch both PDFs
      const pdf1BufferOriginal = await fetchPDF(pdfUrl1);
      const pdf2BufferOriginal = await fetchPDF(pdfUrl2);
      
      // Clone buffers properly - pdf.js transfers buffers to workers which detaches them
      // We need separate independent copies for pdf.js and pdf-lib
      const pdf1Array = new Uint8Array(pdf1BufferOriginal);
      const pdf2Array = new Uint8Array(pdf2BufferOriginal);
      
      const pdf1BufferForJS = pdf1Array.slice().buffer;
      const pdf2BufferForJS = pdf2Array.slice().buffer;
      const pdf1BufferForLib = pdf1Array.slice().buffer;
      const pdf2BufferForLib = pdf2Array.slice().buffer;
      
      statusDiv.textContent = 'Loading PDF documents...';
      
      // Load PDFs with pdf-lib first (doesn't transfer buffers)
      const pdf1Doc = await PDFLib.PDFDocument.load(pdf1BufferForLib);
      const pdf2Doc = await PDFLib.PDFDocument.load(pdf2BufferForLib);
      
      // Then load with pdf.js for text extraction (may transfer buffers to worker)
      const pdf1 = await pdfjsLib.getDocument({ data: pdf1BufferForJS }).promise;
      const pdf2 = await pdfjsLib.getDocument({ data: pdf2BufferForJS }).promise;
      
      const maxPages = Math.max(pdf1.numPages, pdf2.numPages);
      statusDiv.textContent = `Comparing ${maxPages} pages...`;
      
      // Create a new PDF document for the diff
      const diffDoc = await PDFLib.PDFDocument.create();
      
      // Compare pages
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        try {
          const hasPage1 = pageNum <= pdf1.numPages;
          const hasPage2 = pageNum <= pdf2.numPages;
          
          if (!hasPage1) {
          // Page only in PDF2 - add it with green highlight
          const [page2] = await diffDoc.copyPages(pdf2Doc, [pageNum - 1]);
          const newPage = diffDoc.addPage(page2);
          // Add green border to indicate addition
          const { width, height } = newPage.getSize();
          newPage.drawRectangle({
            x: 0,
            y: 0,
            width: width,
            height: height,
            borderColor: PDFLib.rgb(0, 1, 0),
            borderWidth: 3,
          });
        } else if (!hasPage2) {
          // Page only in PDF1 - add it with red highlight
          const [page1] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
          const newPage = diffDoc.addPage(page1);
          // Add red border to indicate deletion
          const { width, height } = newPage.getSize();
          newPage.drawRectangle({
            x: 0,
            y: 0,
            width: width,
            height: height,
            borderColor: PDFLib.rgb(1, 0, 0),
            borderWidth: 3,
          });
          } else {
            // Both pages exist - compare text content with positions
            // pdf.js uses 1-based indexing, pdf-lib uses 0-based
            const page1 = await pdf1.getPage(pageNum);
            const page2 = await pdf2.getPage(pageNum);
            
            const text1 = await page1.getTextContent();
            const text2 = await page2.getTextContent();
            
            // Normalize text for comparison (remove extra whitespace)
            const text1Normalized = text1.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
            const text2Normalized = text2.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
            
            console.log(`EPRINT Diff: Comparing page ${pageNum}`);
            console.log(`EPRINT Diff: Text1 length: ${text1Normalized.length}, Text2 length: ${text2Normalized.length}`);
            console.log(`EPRINT Diff: Texts match: ${text1Normalized === text2Normalized}`);
            
            // Quick check: if text is identical, skip detailed comparison
            if (text1Normalized === text2Normalized) {
              console.log(`EPRINT Diff: Page ${pageNum} is identical, skipping diff`);
              // Pages are identical - add one page
              const [page1Copy] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
              diffDoc.addPage(page1Copy);
              continue;
            }
            
            console.log(`EPRINT Diff: Page ${pageNum} has differences, computing detailed diff`);
            
            const viewport1 = page1.getViewport({ scale: 1.0 });
            const viewport2 = page2.getViewport({ scale: 1.0 });
            
            // Get page dimensions
            const page1Info = await pdf1Doc.getPage(pageNum - 1);
            const page2Info = await pdf2Doc.getPage(pageNum - 1);
            const { width, height } = page1Info.getSize();
            
            // Compare text items with their positions
            // Pass pdf-lib page height for accurate coordinate conversion
            const differences = findTextDifferences(text1.items, text2.items, viewport1, viewport2, height, height);
            
            console.log(`EPRINT Diff: Page ${pageNum} differences:`, {
              deleted: differences.deleted.length,
              added: differences.added.length,
              modified: differences.modified.length,
              hasChanges: differences.hasChanges
            });
            
            // Double-check: if no actual differences found, treat as identical
            if (!differences.hasChanges || 
                (differences.deleted.length === 0 && 
                 differences.added.length === 0 && 
                 differences.modified.length === 0)) {
              console.log(`EPRINT Diff: Page ${pageNum} marked as identical (no differences found)`);
              const [page1Copy] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
              diffDoc.addPage(page1Copy);
              continue;
            }
            
            if (differences.hasChanges) {
              // Pages differ - create annotated versions showing changes
              const [page1Copy] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
              const [page2Copy] = await diffDoc.copyPages(pdf2Doc, [pageNum - 1]);
              
              const newPage1 = diffDoc.addPage(page1Copy);
              const newPage2 = diffDoc.addPage(page2Copy);
              
              // Highlight deleted text on page 1 (red)
              differences.deleted.forEach(region => {
                newPage1.drawRectangle({
                  x: region.x,
                  y: region.y, // y is bottom edge (baseline) in bottom-up coordinates
                  width: region.width,
                  height: region.height,
                  color: PDFLib.rgb(1, 0.7, 0.7), // Light red
                  opacity: 0.15, // More transparent for better readability
                });
              });
              
              // Highlight added text on page 2 (green)
              differences.added.forEach(region => {
                newPage2.drawRectangle({
                  x: region.x,
                  y: region.y, // y is bottom edge (baseline) in bottom-up coordinates
                  width: region.width,
                  height: region.height,
                  color: PDFLib.rgb(0.7, 1, 0.7), // Light green
                  opacity: 0.15, // More transparent for better readability
                });
              });
              
              // Highlight modified text on both pages (yellow)
              differences.modified.forEach(region => {
                newPage1.drawRectangle({
                  x: region.x1,
                  y: region.y1, // y is bottom edge (baseline) in bottom-up coordinates
                  width: region.width1,
                  height: region.height1,
                  color: PDFLib.rgb(1, 1, 0.5), // Light yellow
                  opacity: 0.15, // More transparent for better readability
                });
                newPage2.drawRectangle({
                  x: region.x2,
                  y: region.y2, // y is bottom edge (baseline) in bottom-up coordinates
                  width: region.width2,
                  height: region.height2,
                  color: PDFLib.rgb(1, 1, 0.5), // Light yellow
                  opacity: 0.15, // More transparent for better readability
                });
              });
              
              // Add labels
              // pdf1 is the old version (second choice), pdf2 is the new version (first choice)
              newPage1.drawText('Old Version (deletions in red, changes in yellow)', {
                x: 10,
                y: height - 20,
                size: 10,
                color: PDFLib.rgb(0.5, 0, 0),
              });
              
              newPage2.drawText('New Version (additions in green, changes in yellow)', {
                x: 10,
                y: height - 20,
                size: 10,
                color: PDFLib.rgb(0, 0.5, 0),
              });
            }
            // Note: Identical pages are already handled earlier with the continue statement
          }
        } catch (pageError) {
          console.error(`EPRINT Diff: Error processing page ${pageNum}:`, pageError);
          // Add the page from PDF1 as a fallback
          try {
            if (pageNum <= pdf1.numPages) {
              const [page1Copy] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
              diffDoc.addPage(page1Copy);
            } else if (pageNum <= pdf2.numPages) {
              const [page2Copy] = await diffDoc.copyPages(pdf2Doc, [pageNum - 1]);
              diffDoc.addPage(page2Copy);
            }
          } catch (fallbackError) {
            console.error(`EPRINT Diff: Error adding fallback page ${pageNum}:`, fallbackError);
          }
        }
      }
      
      statusDiv.textContent = 'Generating diff PDF...';
      
      // Check if we have any pages in the diff document
      const pageCount = diffDoc.getPageCount();
      console.log(`EPRINT Diff: Diff document has ${pageCount} pages`);
      
      if (pageCount === 0) {
        throw new Error('No pages were added to the diff document. This should not happen.');
      }
      
      // Generate the PDF bytes
      console.log('EPRINT Diff: Saving PDF document...');
      const pdfBytes = await diffDoc.save();
      console.log(`EPRINT Diff: PDF saved, size: ${pdfBytes.length} bytes`);
      
      // Download the PDF
      console.log('EPRINT Diff: Creating download...');
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'eprint-diff.pdf';
      document.body.appendChild(a);
      
      try {
        a.click();
        console.log('EPRINT Diff: Download triggered');
      } catch (downloadError) {
        console.error('EPRINT Diff: Error triggering download:', downloadError);
        // Fallback: try to open in new window
        window.open(url, '_blank');
      }
      
      // Clean up after a short delay to ensure download starts
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      statusDiv.className = 'eprint-diff-status success';
      statusDiv.textContent = `Diff PDF generated successfully! (${pageCount} pages)`;
      
    } catch (error) {
      console.error('Error comparing PDFs:', error);
      statusDiv.className = 'eprint-diff-status error';
      statusDiv.textContent = `Error: ${error.message}`;
    }
  }

  // Initialize the extension
  function init() {
    // Check if we're on the right page
    if (!window.location.href.startsWith('https://eprint.iacr.org/archive/versions/')) {
      console.log('EPRINT Diff: Not on archive versions page');
      return;
    }

    console.log('EPRINT Diff: Extension initialized, looking for archive links...');

    // Try to extract links immediately
    let links = extractArchiveLinks();
    console.log(`EPRINT Diff: Found ${links.length} archive links on initial scan`);

    // If we found links, create UI
    if (links.length >= 2) {
      createUI(links);
      return;
    }

    // If no links found, wait a bit and try again (for dynamically loaded content)
    let attempts = 0;
    const maxAttempts = 10;
    const checkInterval = setInterval(() => {
      attempts++;
      links = extractArchiveLinks();
      console.log(`EPRINT Diff: Attempt ${attempts}: Found ${links.length} archive links`);
      
      if (links.length >= 2) {
        clearInterval(checkInterval);
        createUI(links);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.log('EPRINT Diff: Gave up after', maxAttempts, 'attempts');
        // Show UI anyway with a message
        showErrorUI('Could not find archive links on this page. Make sure you are on a page with version links.');
      }
    }, 500);

    // Also use MutationObserver to watch for dynamically added content
    const observer = new MutationObserver(() => {
      links = extractArchiveLinks();
      if (links.length >= 2) {
        const existingUI = document.getElementById('eprint-diff-container');
        if (!existingUI) {
          clearInterval(checkInterval);
          observer.disconnect();
          createUI(links);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Create UI with links
  function createUI(links) {
    // Check if UI already exists
    if (document.getElementById('eprint-diff-container')) {
      console.log('EPRINT Diff: UI already exists');
      return;
    }

    console.log('EPRINT Diff: Creating UI with', links.length, 'links');
    const container = createDiffUI();
    populateSelects(links);

    // Add event listeners
    const select1 = document.getElementById('eprint-select-1');
    const select2 = document.getElementById('eprint-select-2');
    const button = document.getElementById('eprint-diff-button');

    select1.addEventListener('change', updateCompareButton);
    select2.addEventListener('change', updateCompareButton);

    button.addEventListener('click', () => {
      const url1 = select1.value; // First choice = new version
      const url2 = select2.value; // Second choice = old version
      if (url1 && url2 && url1 !== url2) {
        // Swap order: url1 (new) becomes pdf2, url2 (old) becomes pdf1
        comparePDFs(url2, url1); // Pass old first, new second
      }
    });
  }

  // Show error UI
  function showErrorUI(message) {
    const container = document.createElement('div');
    container.id = 'eprint-diff-container';
    container.className = 'eprint-diff-container';
    container.innerHTML = `
      <button class="eprint-diff-close" onclick="this.parentElement.remove()">×</button>
      <div class="eprint-diff-title">Compare PDF Versions</div>
      <div class="eprint-diff-status error">${message}</div>
    `;
    document.body.appendChild(container);
  }

  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Page already loaded, but wait a bit for dynamic content
    setTimeout(init, 1000);
  }
})();
