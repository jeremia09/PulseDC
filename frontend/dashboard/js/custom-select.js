/* ============================================================
   custom-select.js — Modern Animated Custom Select Engine
   Replaces native browser <select> with a rich, animated,
   glassmorphic popover dropdown while maintaining full
   bidirectional sync with the underlying <select> element.
   ============================================================ */

(function () {
  'use strict';

  const selectInstances = new WeakMap();

  function createCustomSelect(selectEl) {
    if (!selectEl) return null;
    if (selectInstances.has(selectEl)) {
      return selectInstances.get(selectEl);
    }

    // Container wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';
    if (selectEl.id) wrapper.setAttribute('data-for', selectEl.id);

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'custom-select-label';
    labelSpan.textContent = 'Select...';

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'custom-select-arrow';
    arrowSpan.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m6 9 6 6 6-6"/>
      </svg>
    `;

    trigger.appendChild(labelSpan);
    trigger.appendChild(arrowSpan);

    // Dropdown popover menu
    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('tabindex', '-1');

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';
    menu.appendChild(optionsContainer);

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    // Insert next to native select
    selectEl.parentNode.insertBefore(wrapper, selectEl);
    selectEl.classList.add('custom-select-native-hidden');

    let isOpen = false;
    let focusedIndex = -1;

    function getOptions() {
      return Array.from(optionsContainer.querySelectorAll('.custom-select-option:not(.disabled)'));
    }

    function openMenu() {
      if (selectEl.disabled) return;
      // Close other open dropdowns first
      document.querySelectorAll('.custom-select-wrapper.is-open').forEach(w => {
        if (w !== wrapper) {
          const inst = w._customSelectInstance;
          if (inst) inst.close();
        }
      });

      isOpen = true;
      wrapper.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');

      // Scroll selected item into view
      const selected = optionsContainer.querySelector('.custom-select-option.selected');
      if (selected) {
        setTimeout(() => {
          selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 30);
      }
    }

    function closeMenu() {
      if (!isOpen) return;
      isOpen = false;
      wrapper.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      focusedIndex = -1;
      clearHighlights();
    }

    function toggleMenu() {
      if (isOpen) closeMenu();
      else openMenu();
    }

    function clearHighlights() {
      getOptions().forEach(opt => opt.classList.remove('highlighted'));
    }

    function highlightOption(index) {
      const opts = getOptions();
      if (index < 0 || index >= opts.length) return;
      clearHighlights();
      focusedIndex = index;
      const target = opts[focusedIndex];
      target.classList.add('highlighted');
      target.scrollIntoView({ block: 'nearest' });
    }

    function syncFromNative() {
      // Sync display visibility
      if (selectEl.style.display === 'none') {
        wrapper.style.display = 'none';
      } else {
        wrapper.style.display = '';
      }

      // Sync border left (for cross-room indicators)
      if (selectEl.style.borderLeft) {
        trigger.style.borderLeft = selectEl.style.borderLeft;
        trigger.classList.add('has-accent-border');
      } else {
        trigger.style.borderLeft = '';
        trigger.classList.remove('has-accent-border');
      }

      // Sync title / tooltip
      if (selectEl.title) {
        trigger.title = selectEl.title;
      } else {
        trigger.removeAttribute('title');
      }

      // Sync disabled state
      trigger.disabled = selectEl.disabled;
      if (selectEl.disabled) wrapper.classList.add('disabled');
      else wrapper.classList.remove('disabled');

      // Build options
      optionsContainer.innerHTML = '';
      let selectedText = '';
      let hasSelected = false;

      const children = Array.from(selectEl.children);

      function renderOption(opt) {
        const optionEl = document.createElement('div');
        optionEl.className = 'custom-select-option';
        optionEl.setAttribute('role', 'option');
        optionEl.setAttribute('data-value', opt.value);

        const isSelected = opt.value === selectEl.value;
        if (isSelected) {
          optionEl.classList.add('selected');
          optionEl.setAttribute('aria-selected', 'true');
          selectedText = opt.textContent;
          hasSelected = true;
        } else {
          optionEl.setAttribute('aria-selected', 'false');
        }

        if (opt.disabled) {
          optionEl.classList.add('disabled');
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'custom-select-option-text';
        textSpan.textContent = opt.textContent;

        const checkSpan = document.createElement('span');
        checkSpan.className = 'custom-select-check';
        checkSpan.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        `;

        optionEl.appendChild(textSpan);
        optionEl.appendChild(checkSpan);

        optionEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (opt.disabled) return;
          if (selectEl.value !== opt.value) {
            selectEl.value = opt.value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          syncFromNative();
          closeMenu();
          trigger.focus();
        });

        return optionEl;
      }

      children.forEach(child => {
        if (child.tagName === 'OPTGROUP') {
          const groupEl = document.createElement('div');
          groupEl.className = 'custom-select-group';

          const groupHeader = document.createElement('div');
          groupHeader.className = 'custom-select-group-header';
          groupHeader.innerHTML = `
            <span class="custom-select-group-icon"><i class="fi fi-rr-building" aria-hidden="true"></i></span>
            <span class="custom-select-group-title">${child.label}</span>
          `;
          groupEl.appendChild(groupHeader);

          const groupItems = document.createElement('div');
          groupItems.className = 'custom-select-group-items';
          Array.from(child.children).forEach(opt => {
            if (opt.tagName === 'OPTION') {
              groupItems.appendChild(renderOption(opt));
            }
          });
          groupEl.appendChild(groupItems);
          optionsContainer.appendChild(groupEl);
        } else if (child.tagName === 'OPTION') {
          optionsContainer.appendChild(renderOption(child));
        }
      });

      // Update trigger label
      if (hasSelected && selectedText) {
        labelSpan.textContent = selectedText;
      } else if (selectEl.options && selectEl.options.length > 0 && selectEl.selectedIndex >= 0) {
        labelSpan.textContent = selectEl.options[selectEl.selectedIndex].textContent;
      } else {
        labelSpan.textContent = selectEl.getAttribute('placeholder') || 'Select option...';
      }
    }

    // Trigger click
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    // Keyboard navigation
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Down') {
        e.preventDefault();
        if (!isOpen) {
          openMenu();
          highlightOption(0);
        } else {
          const opts = getOptions();
          const next = focusedIndex < opts.length - 1 ? focusedIndex + 1 : 0;
          highlightOption(next);
        }
      } else if (e.key === 'ArrowUp' || e.key === 'Up') {
        e.preventDefault();
        if (!isOpen) {
          openMenu();
          const opts = getOptions();
          highlightOption(opts.length - 1);
        } else {
          const opts = getOptions();
          const prev = focusedIndex > 0 ? focusedIndex - 1 : opts.length - 1;
          highlightOption(prev);
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (isOpen && focusedIndex >= 0) {
          e.preventDefault();
          const opts = getOptions();
          if (opts[focusedIndex]) opts[focusedIndex].click();
        } else if (!isOpen && e.key === 'Enter') {
          e.preventDefault();
          openMenu();
        }
      } else if (e.key === 'Escape' || e.key === 'Esc') {
        if (isOpen) {
          e.preventDefault();
          closeMenu();
        }
      } else if (e.key === 'Tab') {
        closeMenu();
      }
    });

    // Intercept .value setter on selectEl so programmatic changes automatically reflect
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (desc && desc.set) {
      const origSet = desc.set;
      const origGet = desc.get;
      Object.defineProperty(selectEl, 'value', {
        get() {
          return origGet.call(this);
        },
        set(val) {
          origSet.call(this, val);
          syncFromNative();
        },
        configurable: true
      });
    }

    // MutationObserver to track innerHTML and attribute changes (like style.display, style.borderLeft)
    const observer = new MutationObserver(() => {
      syncFromNative();
    });
    observer.observe(selectEl, { childList: true, attributes: true, subtree: true });

    selectEl.addEventListener('change', () => {
      syncFromNative();
    });

    // Initial sync
    syncFromNative();

    const instance = {
      wrapper,
      trigger,
      menu,
      sync: syncFromNative,
      open: openMenu,
      close: closeMenu
    };

    wrapper._customSelectInstance = instance;
    selectInstances.set(selectEl, instance);
    return instance;
  }

  // Global listener to close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrapper')) {
      document.querySelectorAll('.custom-select-wrapper.is-open').forEach(w => {
        if (w._customSelectInstance) w._customSelectInstance.close();
      });
    }
  });

  // Global initializer
  window.initCustomSelects = function () {
    const selects = document.querySelectorAll('select:not(.no-custom-select)');
    selects.forEach(sel => {
      createCustomSelect(sel);
    });
  };

  window.enhanceSelect = createCustomSelect;

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.initCustomSelects();
    });
  } else {
    window.initCustomSelects();
  }
})();
