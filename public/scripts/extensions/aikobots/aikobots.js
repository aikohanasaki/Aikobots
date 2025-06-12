import { isAdmin } from './../../user.js';

// Show elements for admin users
function showElement(selector) {
    try {
        const element = document.querySelector(selector);
        if (element) {
            element.style.display = 'block';
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
        console.log('User is not admin - skipping initialization');
        return;
    }
    
    console.log('Admin user detected - showing admin elements');
    
    // Show admin-only elements
    showElement('[id="advanced-formatting-button"]');
    showElement('[id="extensions-settings-button"]');
    showElement('[id="world_button"]');
    
    console.log('Aikobots admin initialization complete');
}