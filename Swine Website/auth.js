import { supabase } from './supabaseClient.js';

// 1. Function to protect pages
export async function protectPage() {
    const { data: { session }, error } = await supabase.auth.getSession();

    // If there is no session, redirect to the login page
    if (!session || error) {
        console.log("No active session found. Redirecting...");
        window.location.href = 'login.html'; 
    } else {
        console.log("Welcome, authorized user:", session.user.email);
    }
}

// 2. Function to log out
export async function logout() {
    const { error } = await supabase.auth.logout();
    if (error) {
        alert("Error logging out: " + error.message);
    } else {
        window.location.href = 'login.html';
    }
}