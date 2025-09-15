import { isAdmin } from './../../user.js';

// Show elements for admin users
function showElement(selector) {
    try {
        const element = document.querySelector(selector);
        if (element) {
            element.style.display = 'flex';
            console.log(`Showing element: ${selector}`);
        } else {
            console.warn(`Element not found: ${selector}`);
        }
    } catch (error) {
        console.error(`Error showing element ${selector}:`, error);
    }
}

// Main execution function
export async function initializeAikobots() {
    if (!isAdmin()) {
        return;
    }
    // Show admin-only elements
    showElement('[id="advanced-formatting-button"]');
    showElement('[id="extensions_details"]');
    showElement('[id="third_party_extension_button"]');
    showElement('[id="extensions_settings"]');
    showElement('[id="assets_container"]');
    showElement('[id="extensions_settings2"]');
    showElement('[id="world_button"]');
}