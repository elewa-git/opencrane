-- Repair 0.10 databases whose workflow cutover omitted the server's control-plane queue.
SELECT absurd.create_queue('control-plane');
