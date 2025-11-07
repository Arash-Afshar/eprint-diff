(function() {
  'use strict';

  async function loadPDFJS() {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
      return window.pdfjsLib;
    }

    try {
      const pdfjsModule = await import(chrome.runtime.getURL('pdf.min.mjs'));
      const pdfjsLib = pdfjsModule;
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs');
      window.pdfjsLib = pdfjsLib;
      return pdfjsLib;
    } catch (error) {
      console.error('EPRINT Diff: Error loading PDF.js:', error);
      throw new Error('pdf.js library failed to load: ' + error.message);
    }
  }

  async function loadPDFLib() {
    if (window.PDFLib) {
      return window.PDFLib;
    }

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

  function isValidEprintUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.origin === 'https://eprint.iacr.org' && 
             urlObj.pathname.startsWith('/archive/');
    } catch {
      return false;
    }
  }

  function resolveUrl(href, baseUrl) {
    if (href.startsWith('/')) {
      return window.location.origin + href;
    } else if (href.startsWith('http')) {
      return href;
    } else {
      return new URL(href, baseUrl || window.location.href).href;
    }
  }

  function createDiffUI() {
    const container = document.createElement('div');
    container.id = 'eprint-diff-container';
    container.className = 'eprint-diff-container';
    const closeButton = document.createElement('button');
    closeButton.className = 'eprint-diff-close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => container.remove());
    const title = document.createElement('div');
    title.className = 'eprint-diff-title';
    title.textContent = 'Compare PDF Versions';
    const section1 = document.createElement('div');
    section1.className = 'eprint-diff-section';
    const label1 = document.createElement('label');
    label1.className = 'eprint-diff-label';
    label1.setAttribute('for', 'eprint-select-1');
    label1.textContent = 'Select First Version:';
    const select1 = document.createElement('select');
    select1.id = 'eprint-select-1';
    select1.className = 'eprint-diff-select';
    const option1Default = document.createElement('option');
    option1Default.value = '';
    option1Default.textContent = '-- Select --';
    select1.appendChild(option1Default);
    section1.appendChild(label1);
    section1.appendChild(select1);
    const section2 = document.createElement('div');
    section2.className = 'eprint-diff-section';
    const label2 = document.createElement('label');
    label2.className = 'eprint-diff-label';
    label2.setAttribute('for', 'eprint-select-2');
    label2.textContent = 'Select Second Version:';
    const select2 = document.createElement('select');
    select2.id = 'eprint-select-2';
    select2.className = 'eprint-diff-select';
    const option2Default = document.createElement('option');
    option2Default.value = '';
    option2Default.textContent = '-- Select --';
    select2.appendChild(option2Default);
    section2.appendChild(label2);
    section2.appendChild(select2);
    const button = document.createElement('button');
    button.id = 'eprint-diff-button';
    button.className = 'eprint-diff-button';
    button.disabled = true;
    button.textContent = 'Compare PDFs';
    const statusDiv = document.createElement('div');
    statusDiv.id = 'eprint-diff-status';
    container.appendChild(closeButton);
    container.appendChild(title);
    container.appendChild(section1);
    container.appendChild(section2);
    container.appendChild(button);
    container.appendChild(statusDiv);
    document.body.appendChild(container);
    return container;
  }

  function extractArchiveLinks() {
    const links = [];
    // Pattern to match: /archive/YEAR/NUMBER/TIMESTAMP or /archive/versions/YEAR/NUMBER/REVISION
    // Timestamp format: YYYYMMDD:HHMMSS
    const urlPattern = /\/archive\/(?:versions\/)?(\d+)\/(\d+)\/([\d:]+)/;
    const allLinks = document.querySelectorAll('a[href]');
    
    allLinks.forEach(link => {
      const href = link.href || link.getAttribute('href');
      if (!href) return;
      
      const fullUrl = resolveUrl(href);
      const match = fullUrl.match(urlPattern);
      if (match) {
        const [, year, number, revision] = match;
        const archiveUrl = `https://eprint.iacr.org/archive/${year}/${number}/${revision}`;
        
        if (!links.find(l => l.url === archiveUrl)) {
          if (!isValidEprintUrl(archiveUrl)) {
            return;
          }
          const linkText = link.textContent.trim();
          const displayText = linkText || `${year}/${number}/${revision}`;
          
          links.push({
            url: archiveUrl,
            year: parseInt(year),
            number: parseInt(number),
            revision: revision,
            displayText: displayText
          });
        }
      }
    });

    links.sort((a, b) => {
      if (a.revision.includes(':') && b.revision.includes(':')) {
        return b.revision.localeCompare(a.revision);
      }
      return parseInt(b.revision) - parseInt(a.revision);
    });
    
    return links;
  }

  function populateSelects(links) {
    const select1 = document.getElementById('eprint-select-1');
    const select2 = document.getElementById('eprint-select-2');
    
    links.forEach(link => {
      const createOption = (select) => {
        const option = document.createElement('option');
        option.value = link.url;
        option.textContent = link.displayText;
        select.appendChild(option);
      };
      createOption(select1);
      createOption(select2);
    });
  }

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

  async function getPDFUrl(archiveUrl) {
    if (!isValidEprintUrl(archiveUrl)) {
      throw new Error('Invalid archive URL');
    }
    try {
      const response = await fetch(archiveUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch archive page: ${response.statusText}`);
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const allLinks = doc.querySelectorAll('a, button');
      
      for (const element of allLinks) {
        const text = element.textContent.trim().toUpperCase();
        const href = element.href || element.getAttribute('href');
        
        if ((text.includes('PDF') || (href && href.endsWith('.pdf'))) && href) {
          const pdfUrl = resolveUrl(href, archiveUrl);
          if (pdfUrl.endsWith('.pdf') || pdfUrl.includes('.pdf')) {
            if (!isValidEprintUrl(pdfUrl)) {
              continue;
            }
            return pdfUrl;
          }
        }
      }
      
      const pdfLinks = doc.querySelectorAll('a[href$=".pdf"]');
      if (pdfLinks.length > 0) {
        const href = pdfLinks[0].href || pdfLinks[0].getAttribute('href');
        const pdfUrl = resolveUrl(href, archiveUrl);
        return pdfUrl;
      }
      
      throw new Error('Could not find PDF link on archive page');
    } catch (error) {
      console.error('EPRINT Diff: Error getting PDF URL:', error);
      throw error;
    }
  }

  async function fetchPDF(url) {
    if (!isValidEprintUrl(url)) {
      throw new Error('Invalid PDF URL');
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }
    return await response.arrayBuffer();
  }


  function findTextDifferences(items1, items2, viewport1, viewport2, pageHeight1 = null, pageHeight2 = null) {
    const result = {
      hasChanges: false,
      deleted: [],
      added: [],
      modified: []
    };
    
    const extractTextItems = (items, viewport, pageHeight = null) => {
      const heightForConversion = pageHeight || viewport.height;
      return items.map(item => {
        const x = item.transform[4];
        const width = item.width || Math.abs(item.transform[0]) * (item.str.length || 1) * 6 || 20;
        const height = item.height || Math.abs(item.transform[3]) || 12;
        const baselineYTopDown = item.transform[5];
        // Convert coordinates from pdf.js (top-down) to pdf-lib (bottom-up)
        // In pdf.js: Y=0 at top, Y increases downward
        // In pdf-lib: Y=0 at bottom, Y increases upward
        const USE_INVERTED_Y = true;
        const bottomYBottomUp = USE_INVERTED_Y 
          ? baselineYTopDown
          : heightForConversion - baselineYTopDown;
        
        return {
          text: item.str,
          x: x,
          y: bottomYBottomUp,
          width: Math.max(width, 20),
          height: Math.max(height, 10),
        };
      }).filter(item => item.text.trim());
    };
    
    const words1 = extractTextItems(items1, viewport1, pageHeight1);
    const words2 = extractTextItems(items2, viewport2, pageHeight2);
    
    const text1 = words1.map(w => w.text.trim()).filter(t => t).join(' ');
    const text2 = words2.map(w => w.text.trim()).filter(t => t).join(' ');
    
    if (text1 === text2) {
      return result;
    }
    
    const matched1 = new Set();
    const matched2 = new Set();
    const tolerance = 15;
    
    const sortWords = (words) => {
      return [...words].sort((a, b) => {
        const yDiff = b.y - a.y;
        if (Math.abs(yDiff) > 5) return yDiff;
        return a.x - b.x;
      });
    };
    
    const sortedWords1 = sortWords(words1);
    const sortedWords2 = sortWords(words2);
    
    sortedWords1.forEach((word1, i1) => {
      const origIndex1 = words1.indexOf(word1);
      if (matched1.has(origIndex1)) return;
      
      let bestMatch = null;
      let bestDistance = Infinity;
      
      sortedWords2.forEach((word2, i2) => {
        const origIndex2 = words2.indexOf(word2);
        if (matched2.has(origIndex2)) return;
        
        if (word1.text.trim() === word2.text.trim()) {
          const distance = Math.sqrt(
            Math.pow(word1.x - word2.x, 2) + 
            Math.pow(word1.y - word2.y, 2)
          );
          
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
    
    const unmatched1 = words1.filter((w, i) => !matched1.has(i) && w.text.trim());
    const unmatched2 = words2.filter((w, i) => !matched2.has(i) && w.text.trim());
    
    const matchRatio1 = matched1.size / Math.max(words1.length, 1);
    const matchRatio2 = matched2.size / Math.max(words2.length, 1);
    
    result.hasChanges = true;
    
    const addModifiedRegion = (word1, word2) => {
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
    };
    
    if (unmatched1.length > 0 || unmatched2.length > 0 || matchRatio1 < 0.98 || matchRatio2 < 0.98) {
      unmatched1.forEach((word1) => {
        result.deleted.push({
          x: word1.x,
          y: word1.y,
          width: word1.width,
          height: word1.height,
        });
      });
      
      unmatched2.forEach((word2) => {
        result.added.push({
          x: word2.x,
          y: word2.y,
          width: word2.width,
          height: word2.height,
        });
      });
      
      unmatched1.forEach((word1) => {
        unmatched2.forEach((word2) => {
          const distance = Math.sqrt(
            Math.pow(word1.x - word2.x, 2) + 
            Math.pow(word1.y - word2.y, 2)
          );
          
          if (distance < tolerance * 2 && word1.text.trim() !== word2.text.trim()) {
            addModifiedRegion(word1, word2);
          }
        });
      });
      
      words1.forEach((word1, i1) => {
        if (matched1.has(i1)) return;
        
        words2.forEach((word2, i2) => {
          if (matched2.has(i2)) return;
          
          const distance = Math.sqrt(
            Math.pow(word1.x - word2.x, 2) + 
            Math.pow(word1.y - word2.y, 2)
          );
          
          if (distance < tolerance * 2 && word1.text.trim() !== word2.text.trim()) {
            addModifiedRegion(word1, word2);
          }
        });
      });
    }
    
    return result;
  }

  function drawHighlight(page, region, color) {
    page.drawRectangle({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      color: color,
      opacity: 0.15,
    });
  }

  async function comparePDFs(url1, url2) {
    const statusDiv = document.getElementById('eprint-diff-status');
    statusDiv.className = 'eprint-diff-status loading';
    statusDiv.textContent = 'Loading PDF libraries...';

    try {
      const pdfjsLib = await loadPDFJS();
      const PDFLib = await loadPDFLib();
      
      statusDiv.textContent = 'Finding PDF URLs...';
      const pdfUrl1 = await getPDFUrl(url1);
      const pdfUrl2 = await getPDFUrl(url2);
      
      statusDiv.textContent = 'Fetching PDFs...';
      const pdf1BufferOriginal = await fetchPDF(pdfUrl1);
      const pdf2BufferOriginal = await fetchPDF(pdfUrl2);
      
      const pdf1Array = new Uint8Array(pdf1BufferOriginal);
      const pdf2Array = new Uint8Array(pdf2BufferOriginal);
      
      const pdf1BufferForJS = pdf1Array.slice().buffer;
      const pdf2BufferForJS = pdf2Array.slice().buffer;
      const pdf1BufferForLib = pdf1Array.slice().buffer;
      const pdf2BufferForLib = pdf2Array.slice().buffer;
      
      statusDiv.textContent = 'Loading PDF documents...';
      const pdf1Doc = await PDFLib.PDFDocument.load(pdf1BufferForLib);
      const pdf2Doc = await PDFLib.PDFDocument.load(pdf2BufferForLib);
      const pdf1 = await pdfjsLib.getDocument({ data: pdf1BufferForJS }).promise;
      const pdf2 = await pdfjsLib.getDocument({ data: pdf2BufferForJS }).promise;
      
      const maxPages = Math.max(pdf1.numPages, pdf2.numPages);
      statusDiv.textContent = `Comparing ${maxPages} pages...`;
      const diffDoc = await PDFLib.PDFDocument.create();
      
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        try {
          const hasPage1 = pageNum <= pdf1.numPages;
          const hasPage2 = pageNum <= pdf2.numPages;
          
          if (!hasPage1) {
            const [page2] = await diffDoc.copyPages(pdf2Doc, [pageNum - 1]);
            const newPage = diffDoc.addPage(page2);
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
            const [page1] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
            const newPage = diffDoc.addPage(page1);
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
            const page1 = await pdf1.getPage(pageNum);
            const page2 = await pdf2.getPage(pageNum);
            const text1 = await page1.getTextContent();
            const text2 = await page2.getTextContent();
            const text1Normalized = text1.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
            const text2Normalized = text2.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
            
            if (text1Normalized === text2Normalized) {
              const [page1Copy] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
              diffDoc.addPage(page1Copy);
              continue;
            }
            
            const viewport1 = page1.getViewport({ scale: 1.0 });
            const viewport2 = page2.getViewport({ scale: 1.0 });
            const page1Info = await pdf1Doc.getPage(pageNum - 1);
            const { width, height } = page1Info.getSize();
            const differences = findTextDifferences(text1.items, text2.items, viewport1, viewport2, height, height);
            
            if (!differences.hasChanges || 
                (differences.deleted.length === 0 && 
                 differences.added.length === 0 && 
                 differences.modified.length === 0)) {
              const [page1Copy] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
              diffDoc.addPage(page1Copy);
              continue;
            }
            
            const [page1Copy] = await diffDoc.copyPages(pdf1Doc, [pageNum - 1]);
            const [page2Copy] = await diffDoc.copyPages(pdf2Doc, [pageNum - 1]);
            const newPage1 = diffDoc.addPage(page1Copy);
            const newPage2 = diffDoc.addPage(page2Copy);
            
            differences.deleted.forEach(region => {
              drawHighlight(newPage1, region, PDFLib.rgb(1, 0.7, 0.7));
            });
            
            differences.added.forEach(region => {
              drawHighlight(newPage2, region, PDFLib.rgb(0.7, 1, 0.7));
            });
            
            differences.modified.forEach(region => {
              drawHighlight(newPage1, { x: region.x1, y: region.y1, width: region.width1, height: region.height1 }, PDFLib.rgb(1, 1, 0.5));
              drawHighlight(newPage2, { x: region.x2, y: region.y2, width: region.width2, height: region.height2 }, PDFLib.rgb(1, 1, 0.5));
            });
            
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
        } catch (pageError) {
          console.error(`EPRINT Diff: Error processing page ${pageNum}:`, pageError);
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
      const pageCount = diffDoc.getPageCount();
      
      if (pageCount === 0) {
        throw new Error('No pages were added to the diff document. This should not happen.');
      }
      
      const pdfBytes = await diffDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'eprint-diff.pdf';
      document.body.appendChild(a);
      
      try {
        a.click();
      } catch (downloadError) {
        console.error('EPRINT Diff: Error triggering download:', downloadError);
        window.open(url, '_blank');
      }
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
      
      statusDiv.className = 'eprint-diff-status success';
      statusDiv.textContent = `Diff PDF generated successfully! (${pageCount} pages)`;
      
    } catch (error) {
      console.error('Error comparing PDFs:', error);
      statusDiv.className = 'eprint-diff-status error';
      const errorMessage = error.message || 'An unknown error occurred';
      statusDiv.textContent = `Error: ${errorMessage.length > 100 ? errorMessage.substring(0, 100) + '...' : errorMessage}`;
    }
  }

  function init() {
    if (!window.location.href.startsWith('https://eprint.iacr.org/archive/versions/')) {
      return;
    }

    let links = extractArchiveLinks();

    if (links.length >= 2) {
      createUI(links);
      return;
    }

    let attempts = 0;
    const maxAttempts = 10;
    const checkInterval = setInterval(() => {
      attempts++;
      links = extractArchiveLinks();
      
      if (links.length >= 2) {
        clearInterval(checkInterval);
        createUI(links);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        showErrorUI('Could not find archive links on this page. Make sure you are on a page with version links.');
      }
    }, 500);

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

  function createUI(links) {
    if (document.getElementById('eprint-diff-container')) {
      return;
    }

    const container = createDiffUI();
    populateSelects(links);

    const select1 = document.getElementById('eprint-select-1');
    const select2 = document.getElementById('eprint-select-2');
    const button = document.getElementById('eprint-diff-button');

    select1.addEventListener('change', updateCompareButton);
    select2.addEventListener('change', updateCompareButton);

    button.addEventListener('click', () => {
      const url1 = select1.value;
      const url2 = select2.value;
      if (url1 && url2 && url1 !== url2) {
        if (!isValidEprintUrl(url1) || !isValidEprintUrl(url2)) {
          showErrorUI('Invalid URL selected. Please select valid archive versions.');
          return;
        }
        comparePDFs(url2, url1);
      }
    });
  }

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 1000);
  }
})();
